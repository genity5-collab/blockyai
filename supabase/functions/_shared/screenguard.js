// Decides whether a frame of the AI's screen may be shown to the user. It looks at the TEXT of the page and the address (read through the browser
// at the moment of the screenshot) and at what the AI just typed. A frame that is not clearly safe becomes a black "fixing it" frame.
// Honest limit: a secret that exists ONLY as pixels (a photo of a key) cannot be found from text. The AI is told to browse public sites only.

// Things that look like keys, tokens, passwords, private keys and connection strings.
const SECRET_PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["login token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ["access token", /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
  ["aws key", /\b(AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github token", /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ["slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["stripe key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/],
  ["secret key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["google api key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["supabase key", /\bsb_(secret|publishable)_[A-Za-z0-9_-]{16,}/],
  ["system secret", /\b(BLOCKY_[A-Z_]{3,}|FREESTYLE_[A-Z_]{3,}|SERVICE_ROLE[A-Z_]*|SUPABASE_[A-Z_]*KEY)\b\s*[=:]\s*\S{6,}/],
  ["password or secret", /(password|passwd|pwd|secret|secret[_-]?key|api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|signing[_-]?key)["']?\s*[:=]\s*["']?[^\s"',;]{6,}/i],
  ["connection string", /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/i],
  ["credit card", /\b(?:\d[ -]?){13,19}\b/],
  ["discord token", /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/],
  ["secret code", /\b[a-f0-9]{40,}\b/i],
];
const luhn = (s) => { const d = s.replace(/\D/g, ""); if (d.length < 13 || d.length > 19) return false; let sum = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };

// Pages that are private by nature, whatever they show.
const BLOCKED_SCHEMES = /^(chrome|chrome-extension|chrome-untrusted|devtools|view-source|file|about|blob|data|filesystem|javascript|ftp):/i;
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|metadata\.google\.internal)/i;
const PRIVATE_PATHS = /\/(login|log-in|signin|sign-in|sign_in|signup|sign-up|register|password|reset|account|accounts|settings|security|billing|payment|checkout|oauth|auth|authorize|token|tokens|api-keys?|keys|secrets?|credentials|2fa|mfa|verify|session)(\/|$|\?|#)/i;
const PRIVATE_HOSTS = /(^|\.)(accounts\.google\.com|login\.|auth\.|id\.|signin\.|mail\.google\.com|outlook\.(live|office)\.com|web\.whatsapp\.com|discord\.com\/(channels|login)|app\.supabase\.com|supabase\.com\/dashboard|dashboard\.|console\.|github\.com\/settings|paypal\.com|stripe\.com|bank)/i;

// String() can throw (an object whose toString throws, or one with no prototype). The guard must never throw, and what it cannot read is not safe.
const UNREADABLE = Symbol("unreadable");
const toStr = (v) => { if (v == null) return ""; if (typeof v === "string") return v; if (typeof v === "number" || typeof v === "boolean") return String(v); return UNREADABLE; };

export function urlRisk(raw) {
  const s0 = toStr(raw); if (s0 === UNREADABLE) return { risky: true, why: "an address I could not read" };
  const s = s0.trim();
  if (!s) return { risky: false };
  if (BLOCKED_SCHEMES.test(s)) return { risky: true, why: "a private browser page" };
  let u; try { u = new URL(s); } catch { return { risky: true, why: "an address I could not read" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { risky: true, why: "a private page" };
  if (u.username || u.password) return { risky: true, why: "an address with a password in it" };
  if (BLOCKED_HOSTS.test(u.hostname)) return { risky: true, why: "a private network address" };
  if (PRIVATE_HOSTS.test(u.hostname + (u.pathname.startsWith("/dashboard") || u.pathname.startsWith("/channels") ? u.pathname : ""))) return { risky: true, why: "a sign-in or account page" };
  // Only a known encyclopedia article path (/wiki/Login) is exempt, and only when it is exactly /wiki/<one title> with no dot-segments. Everything else
  // that looks like a sign-in or settings path stays blocked: showing a settings page by mistake is worse than hiding a harmless article.
  const wikiArticle = /^\/wiki\/[^/]+$/.test(u.pathname) && /(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$|(^|\.)fandom\.com$|(^|\.)miraheze\.org$/i.test(u.hostname);
  if (!wikiArticle && PRIVATE_PATHS.test(u.pathname)) return { risky: true, why: "a sign-in or account page" };
  if (!wikiArticle && /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c/i.test(u.pathname + u.search)) return { risky: true, why: "an address that is trying to look like another page" };
  if (/[?&#](access_token|id_token|refresh_token|token|code|api[_-]?key|key|secret|password|session|sid|auth)=/i.test(u.search + u.hash)) return { risky: true, why: "an address that carries a secret" };
  return { risky: false };
}

export function textRisk(text) {
  const t0 = toStr(text); if (t0 === UNREADABLE) return { risky: true, why: "text I could not read" };
  const t = t0.slice(0, 200_000);
  for (const [name, re] of SECRET_PATTERNS) {
    const m = re.exec(t); if (!m) continue;
    if (name === "credit card" && !luhn(m[0])) continue;                  // an ordinary long number is not a card
    return { risky: true, why: "something that looks like " + (/^[aeiou]/i.test(name) ? "an " : "a ") + name };
  }
  // A sign-in form normally shows up as a password INPUT, which the caller reports separately (hasPasswordField). This is the backup for a form the page
  // script cannot see (inside a frame, or drawn on a canvas). A long article about logging in uses the same words, so we look at the SHAPE:
  // a short page, or the top of a page, that asks for a password and a way to sign in.
  const asksPassword = /\bpassword\b/i, asksSignIn = /\b(sign[ -]?in|log[ -]?in|login|continue)\b/i, formish = /\b(forgot|enter|your|email|username|user name|phone|required)\b|_{3,}/i;
  const top = t.slice(0, t.length < 1500 ? 1500 : 600);
  if (asksPassword.test(top) && asksSignIn.test(top) && formish.test(top)) return { risky: true, why: "a sign-in form" };
  return { risky: false };
}

// What the page said about itself: any password input, or a field the AI is typing into that is secret-like.
export function pageRisk({ url, title, text, hasPasswordField = false, typed = "" } = {}) {
  if (hasPasswordField) return { risky: true, why: "a password field" };
  for (const r of [urlRisk(url), textRisk(title), textRisk(text), textRisk(typed)]) if (r.risky) return r;
  return { risky: false };
}

// Never show the user the raw reason if it would repeat the secret. Reasons above only ever name a KIND of thing.
export const BLACK_FRAME_NOTE = "This view is hidden because it may show something private. I am fixing it myself and will bring the view back.";

// Decision for one frame. `stale` = the page text could not be read at all: when we cannot check, we do not show.
export function frameDecision(info) {
  if (!info || typeof info !== "object") return { show: false, why: "I could not check this view", reason_kind: "unchecked" };
  if (info.unreadable) return { show: false, why: "I could not check this view", reason_kind: "unchecked" };
  const r = pageRisk(info);
  return r.risky ? { show: false, why: r.why, reason_kind: "private" } : { show: true };
}
