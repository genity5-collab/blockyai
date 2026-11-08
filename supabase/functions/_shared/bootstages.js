// The real steps of starting a VM, in order, and the share of the whole wait each one represents.
// Weights come from measured boots (create from snapshot is the slow part), not from a made-up animation.
export const STAGES = [
  { id: "queued",   pct: 3,   label: "Getting your workspace ready" },
  { id: "creating", pct: 10,  label: "Starting your private computer" },
  { id: "created",  pct: 60,  label: "Computer is on" },
  { id: "creds",    pct: 72,  label: "Securing your session" },
  { id: "service",  pct: 84,  label: "Waking up the AI" },
  { id: "verified", pct: 96,  label: "Checking the AI is alive" },
  { id: "ready",    pct: 100, label: "Ready" },
];
const IDX = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(STAGES.map((s, i) => [s.id, i]))));   // no inherited keys such as "constructor"
export const isStage = (id) => typeof id === "string" && id in IDX;
export const stageInfo = (id) => STAGES[isStage(id) ? IDX[id] : 0];
// Percentage shown to the user. While one step is running the number creeps toward (but never reaches) the next step's value, so the bar keeps
// moving during the slow step, but it can never claim more than has really happened, and it never goes backwards.
export function bootPercent(stage, msInStage = 0) {
  if (!isStage(stage)) return 0; const i = IDX[stage];
  const cur = STAGES[i].pct; if (stage === "ready") return 100;
  const next = STAGES[i + 1].pct, span = next - cur;
  const ms = Number.isFinite(msInStage) ? msInStage : 0;
  const creep = Math.min(0.85, Math.max(0, ms) / 15000) * span;       // at most 85% of the way to the next step
  return Math.min(next - 1, Math.floor(cur + creep));
}
