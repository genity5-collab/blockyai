import React from "react";
// Original mark: a glowing isometric cube with a spark. No Roblox assets.
export default function Logo({ size = 40, glow = true, spin = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="BlockyAI logo" role="img"
      style={{ filter: glow ? "drop-shadow(0 0 10px rgba(0,162,255,.85))" : "none", animation: spin ? "bob 4s ease-in-out infinite" : "none", overflow: "visible" }}>
      <defs>
        <linearGradient id="lt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bfeaff" /><stop offset="1" stopColor="#4fc3ff" /></linearGradient>
        <linearGradient id="ll" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#12a4ff" /><stop offset="1" stopColor="#0068b0" /></linearGradient>
        <linearGradient id="lr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0a7fd0" /><stop offset="1" stopColor="#063f78" /></linearGradient>
      </defs>
      <path d="M32 6 54 19 32 32 10 19z" fill="url(#lt)" /><path d="M10 19 32 32v26L10 45z" fill="url(#ll)" /><path d="M54 19 32 32v26l22-13z" fill="url(#lr)" />
      <path d="M32 6 54 19v26L32 58 10 45V19z" fill="none" stroke="#e8f7ff" strokeWidth="1.6" strokeLinejoin="round" opacity=".9" />
      <path d="M32 32v26M10 19l22 13 22-13" stroke="#e8f7ff" strokeWidth="1.2" opacity=".55" fill="none" />
      <g style={{ transformOrigin: "50px 12px", animation: "twinkle 2.4s ease-in-out infinite" }}>
        <path d="M50 2c.7 5 2.6 7 8 8-5.4 1-7.3 3-8 8-.7-5-2.6-7-8-8 5.4-1 7.3-3 8-8z" fill="#fff" /><path d="M50 2c.7 5 2.6 7 8 8-5.4 1-7.3 3-8 8-.7-5-2.6-7-8-8 5.4-1 7.3-3 8-8z" fill="#02FF8A" opacity=".55" />
      </g>
      <style>{`@keyframes twinkle{0%,100%{transform:scale(.8) rotate(0);opacity:.8}50%{transform:scale(1.15) rotate(20deg);opacity:1}}@keyframes bob{0%,100%{transform:translateY(0) rotateY(0)}50%{transform:translateY(-6px) rotateY(12deg)}}`}</style>
    </svg>
  );
}
