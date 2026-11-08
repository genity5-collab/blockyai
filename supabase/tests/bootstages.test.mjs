import { STAGES, stageInfo, isStage, bootPercent } from "../functions/_shared/bootstages.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
ok(STAGES[0].pct > 0 && STAGES.at(-1).id === "ready" && STAGES.at(-1).pct === 100, "starts above 0, ends at ready = 100");
ok(STAGES.every((s, i) => i === 0 || s.pct > STAGES[i - 1].pct), "stage values strictly increase");
ok(STAGES.every((s) => s.label && !/[\u2014\u2013]/.test(s.label)), "every stage has a plain label");
// never claims 100 before ready, never goes backwards, never passes the next stage
for (const st of STAGES.slice(0, -1)) {
  const i = STAGES.findIndex((x) => x.id === st.id), next = STAGES[i + 1].pct; let prev = -1, mono = true, below = true;
  for (let ms = 0; ms <= 120000; ms += 500) { const p = bootPercent(st.id, ms); if (p < prev) mono = false; if (p >= next) below = false; prev = p; }
  ok(mono, st.id + ": creeping never goes backwards"); ok(below, st.id + ": creeping never reaches the next stage's number"); ok(bootPercent(st.id, 0) === st.pct, st.id + ": starts exactly at its value");
}
ok(bootPercent("ready", 0) === 100 && bootPercent("ready", 999999) === 100, "ready is always 100");
ok(bootPercent("verified", 10 ** 9) < 100, "even after a very long wait, 'verified' is below 100 (only real ready gives 100)");
ok(bootPercent("nope") === 0 && bootPercent(null) === 0 && bootPercent(undefined) === 0, "unknown stage gives 0");
ok(bootPercent("creating", -5000) === STAGES[1].pct, "negative time (clock skew) does not push it below the stage value");
ok(bootPercent("creating", NaN) === STAGES[1].pct, "NaN time is safe");
ok(stageInfo("zzz") === STAGES[0] && stageInfo(null) === STAGES[0], "unknown stage info falls back to the first");
ok(isStage("creds") && !isStage("hack") && !isStage("__proto__") && !isStage("constructor") && !isStage("toString"), "isStage rejects inherited object keys");
// crossing a stage boundary is monotonic as well (stage N at its worst-case creep vs stage N+1 at its start)
for (let i = 0; i < STAGES.length - 1; i++) ok(bootPercent(STAGES[i].id, 10 ** 9) <= STAGES[i + 1].pct, "moving from " + STAGES[i].id + " to the next stage never decreases the bar");
console.log(`bootstages: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
