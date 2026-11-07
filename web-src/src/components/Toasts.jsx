import React from "react"; import { useApp } from "../lib/store.jsx";
export default function Toasts() { const { toasts } = useApp();
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={"toast " + t.kind}>{t.text}<i /></div>)}</div>; }
