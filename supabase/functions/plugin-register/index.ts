import { handle, json, admin } from "../_shared/lib.ts";

// Public, read-only. The plugin calls this to learn (a) the latest plugin version and (b) a small cosmetic config.
// IMPORTANT: this returns DATA ONLY. The plugin never downloads or runs code from here (no loadstring of remote text).
// Bump LATEST_VERSION when a new plugin build is committed under /plugin and published on the Get Plugin page.
const LATEST_VERSION = 4;
const CONFIG = {
  theme: { bg: "#0B0E14", card: "#141925", card2: "#1B2233", blue: "#00A2FF", green: "#02FF8A", red: "#FF3B4E", amber: "#FFB800", violet: "#8B5CFF", text: "#E8EEF9", mute: "#8A96AD" },
  labels: { app: "BlockyAI", tagline: "Build Roblox games by talking to them." },
  flags: { chat_tab: true, flash_selection: true, focus_camera: false },
  get_plugin_url: "https://blockyai.onrender.com/#/plugin",
};

// Strict schema for config values: hex colors, short strings, booleans. Anything else is dropped before it leaves the server.
const HEX = /^#[0-9A-Fa-f]{6}$/;
export function sanitizeConfig(c: any) {
  const out: any = { theme: {}, labels: {}, flags: {}, get_plugin_url: "" };
  for (const [k, v] of Object.entries(c?.theme ?? {})) if (typeof v === "string" && HEX.test(v) && /^[a-z0-9]{2,12}$/.test(k)) out.theme[k] = v;
  for (const [k, v] of Object.entries(c?.labels ?? {})) if (typeof v === "string" && v.length <= 80 && /^[a-z_]{2,20}$/.test(k)) out.labels[k] = v.replace(/[<>]/g, "");
  for (const [k, v] of Object.entries(c?.flags ?? {})) if (typeof v === "boolean" && /^[a-z_]{2,24}$/.test(k)) out.flags[k] = v;
  const u = String(c?.get_plugin_url ?? ""); if (/^https:\/\/blockyai\.onrender\.com\//.test(u)) out.get_plugin_url = u;
  return out;
}

Deno.serve(handle(async (req) => {
  // The plugin POSTs {version} (the site proxy forwards POST only); a ?version= query still works for curl.
  const u = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const have = Math.max(0, Math.floor(Number(body.version ?? u.searchParams.get("version") ?? 0))) || 0;
  let changelog: any[] = [];
  try { const { data } = await admin().from("plugin_releases").select("version,label,changelog").order("version", { ascending: false }).limit(10); changelog = data ?? []; } catch { /* table optional */ }
  return json({ latest_version: LATEST_VERSION, update_available: have > 0 && have < LATEST_VERSION, your_version: have || null, config: sanitizeConfig(CONFIG), changelog });
}));
