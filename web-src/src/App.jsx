import React, { useEffect, useState } from "react";
import { useApp } from "./lib/store.jsx";
import World from "./components/World.jsx";
import Landing from "./components/Landing.jsx";
import Workspace from "./components/Workspace.jsx";
import Toasts from "./components/Toasts.jsx";
import { store } from "./lib/util.js";

export default function App() {
  const { sid, data, sessions } = useApp();
  const [reduce] = useState(() => store.get("reduce", false));
  useEffect(() => { document.documentElement.classList.toggle("reduce", !!store.get("reduce", false)); }, []);
  const connected = !!data?.session?.plugin_connected_at;
  return (
    <div className={"app" + (reduce ? " reduce" : "")}>
      <World />
      {sid && connected ? <Workspace /> : <Landing />}
      <Toasts />
    </div>
  );
}
