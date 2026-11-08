import React, { useEffect, useState } from "react";
import { useApp } from "./lib/store.jsx";
import World from "./components/World.jsx";
import Landing from "./components/Landing.jsx";
import Workspace from "./components/Workspace.jsx";
import Toasts from "./components/Toasts.jsx";
import Diagnostics from "./components/Diagnostics.jsx";
import Capability from "./components/Capability.jsx";
import { store } from "./lib/util.js";
import SignInGate from "./components/SignInGate.jsx";
import { useAccount } from "./lib/useAccount.js"; import { AccountProvider } from "./lib/accountContext.jsx";
import { useTokens } from "./lib/useTokens.js"; import { TokensProvider } from "./lib/tokensContext.jsx";
import { shouldShowGate } from "./lib/login.js";

export default function App() {
  const { sid, data, sessions, toast } = useApp();
  const account = useAccount(toast);
  const tokens = useTokens(!!account.acct, toast);
  const [reduce] = useState(() => store.get("reduce", false));
  useEffect(() => { document.documentElement.classList.toggle("reduce", !!store.get("reduce", false)); }, []);
  const connected = !!data?.session?.plugin_connected_at;
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const h = () => setHash(location.hash); addEventListener("hashchange", h); return () => removeEventListener("hashchange", h); }, []);
  const diag = hash.startsWith("#/diagnostics");
  const cap = hash.startsWith("#/capability");
  const gate = shouldShowGate({ acct: account.acct, hash, loginResult: account.loginResult });
  return (
    <AccountProvider value={account}><TokensProvider value={tokens}>
      <div className={"app" + (reduce ? " reduce" : "")}>
        <World />
        {diag ? <Diagnostics /> : cap ? <Capability /> : gate ? <SignInGate busy={account.busy} onDiscord={account.signIn} /> : sid && connected ? <Workspace /> : <Landing />}
        <Toasts />
      </div>
    </TokensProvider></AccountProvider>
  );
}
