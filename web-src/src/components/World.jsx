import React, { useMemo } from "react";
export default function World() {
  const cubes = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ l: Math.random() * 100, s: 10 + Math.random() * 26, d: 18 + Math.random() * 22, dl: -Math.random() * 30, c: ["#00A2FF", "#8B5CFF", "#02FF8A"][i % 3] })), []);
  return (<>
    <div className="world" aria-hidden="true"><div className="floor" />
      <i className="studs tl" /><i className="studs tr" /><i className="studs bl" /><i className="studs br" />
      {cubes.map((c, i) => <span key={i} className="cube-p" style={{ left: c.l + "%", "--s": c.s + "px", "--d": c.d + "s", "--dl": c.dl + "s", "--c": c.c }} />)}
    </div><div className="vig" aria-hidden="true" /><div className="scan" aria-hidden="true" /></>);
}
