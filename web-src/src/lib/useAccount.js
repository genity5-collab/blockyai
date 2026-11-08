import { useEffect, useState, useCallback } from "react";
import { call } from "./api.js";
import { readLoginResult, cleanLoginUrl, loginMessage } from "./login.js";

// One place for the Discord account state: who is signed in, sign in, sign out, and the message after Discord redirects back.
// acct: undefined = loading, null = signed out, { name, avatar_url } = signed in.
export function useAccount(toast) {
  const [acct, setAcct] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [loginResult] = useState(() => readLoginResult(window.location.search));   // read once, before the URL is cleaned

  const load = useCallback(async () => { const r = await call("auth-discord", { action: "me" }); const a = r?.error ? null : r?.account ?? null; setAcct(a); return a; }, []);
  useEffect(() => {
    (async () => {
      const a = await load();
      if (loginResult) {
        const m = loginMessage(loginResult, a?.name); if (m) toast?.(m.text, m.kind);
        window.history.replaceState(null, "", cleanLoginUrl(window.location.pathname, window.location.search, window.location.hash));
      }
    })();
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    const r = await call("auth-discord", { action: "start", return_to: window.location.pathname + window.location.hash });
    if (r?.url && /^https:\/\/discord\.com\/oauth2\/authorize\?/.test(r.url)) { window.location.assign(r.url); return; }
    setBusy(false); toast?.(r?.error || "Could not start Discord sign-in", "error");
  }, [toast]);
  const signOut = useCallback(async () => {
    setBusy(true); const r = await call("auth-discord", { action: "logout" }); setBusy(false);
    if (r?.error) return toast?.(r.error, "error");
    setAcct(null); toast?.("Signed out on this browser", "info");
  }, [toast]);

  return { acct, busy, signIn, signOut, loginResult };
}
