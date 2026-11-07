// Pass/fail rules for the 5 capability tests. PURE: takes recorded facts, returns a verdict with the evidence used.
// Nothing here asks the agent whether it succeeded. A test passes only when the recorded tool results prove each rule.





const okCalls = (calls) => calls.filter((c) => c.name === name && c.ok);
const sum = (calls) => calls.reduce((n, c) => n + (Number(c.result_summary?.[key]) || 0), 0);
const rule = (id: string, text: string, pass: boolean, evidence: string): Rule => ({ id, text, pass, evidence });

// Shared rules every build test needs
function common(calls): Rule[] {
  const builds = okCalls(calls, "build_model");
  const instances = sum(builds, "instances"), errors = sum(builds, "error_count");
  const items = plan?.items ?? [];
  return [
    rule("plan", "A plan was created and every item is done", !!plan && items.length >= 2 && items.every((i) => i.done), plan ? `${items.filter((i) => i.done).length}/${items.length} items done` : "no plan was recorded"),
    rule("verified", "At least one plan item was verified", items.some((i) => i.verified), `${items.filter((i) => i.verified).length} verified item(s)`),
    rule("built", `build_model built at least ${minInstances} instances`, instances >= minInstances, `${instances} instances across ${builds.length} successful build_model call(s)`),
    rule("clean", "build_model reported 0 errors", builds.length > 0 && errors === 0, `${errors} error(s) reported`),
    rule("looked", "The result was looked at (screenshot_multi or a scene report)", okCalls(calls, "screenshot_multi").length + okCalls(calls, "roblox_screenshot").length > 0, `${okCalls(calls, "screenshot_multi").length} screenshot_multi, ${okCalls(calls, "roblox_screenshot").length} scene report(s)`),
  ];
}
const linted = (calls) => okCalls(calls, "vm_lint_luau").length;
const pushed = (calls) => okCalls(calls, "roblox_write_script").length;
const playtested = (calls) => okCalls(calls, "roblox_playtest_start").length > 0;
const usedHeightmapOrFill = (calls) => okCalls(calls, "terrain_heightmap").length + okCalls(calls, "terrain_fill").length;

export const TESTS = {
  yacht: {
    title: "Luxury yacht",
    prompt: "Build me a luxury yacht in the Workspace: hull, deck, cabin with windows, railings, mast with lights. Use real proportions and verify it with screenshots from several angles.",
    evaluate: (calls, plan) => common(calls, plan, 40),
  },
  house: {
    title: "House with a working door",
    prompt: "Build a two-room house with a door that opens when a player uses a ProximityPrompt. Write the door script, lint it, and verify the house with screenshots.",
    evaluate: (calls, plan) => [
      ...common(calls, plan, 30),
      rule("script", "A door script was written and pushed to Studio", pushed(calls) > 0 || sum(okCalls(calls, "build_model"), "parts") > 0 && /Script/.test(calls.map((c) => c.args_summary ?? "").join(" ")), `${pushed(calls)} script push(es)`),
      rule("lint", "A Luau lint passed before the script was pushed", linted(calls) > 0, `${linted(calls)} passing vm_lint_luau call(s)`),
    ],
  },
  obby: {
    title: "10-stage obby",
    prompt: "Make a 10-stage obby with checkpoints, a Stage leaderstat, and kill bricks. Scaffold the services folder, write linted scripts, build the course, and playtest it.",
    evaluate: (calls, plan) => [
      ...common(calls, plan, 60),
      rule("scripts", "At least 2 scripts were pushed (bootstrap and checkpoints)", pushed(calls) >= 2, `${pushed(calls)} script push(es)`),
      rule("lint", "Scripts were linted before pushing", linted(calls) >= 1, `${linted(calls)} passing lint(s)`),
      rule("playtest", "A playtest was started", playtested(calls), `${okCalls(calls, "roblox_playtest_start").length} playtest(s)`),
      rule("logs", "Playtest logs were read", okCalls(calls, "roblox_get_playtest_logs").length > 0, `${okCalls(calls, "roblox_get_playtest_logs").length} log read(s)`),
    ],
  },
  shop: {
    title: "Server-validated shop",
    prompt: "Add a shop with a ScreenGui, a BuyItem RemoteFunction, and a server script that checks the price, the owner's coins and rate limits. Never trust the client. Lint it, push it, and playtest.",
    evaluate: (calls, plan) => {
      const guiBuilt = okCalls(calls, "ui_build").length > 0;
      return [
        rule("plan", "A plan was created and every item is done", !!plan && (plan.items?.length ?? 0) >= 2 && plan!.items.every((i) => i.done), plan ? `${plan.items.filter((i) => i.done).length}/${plan.items.length} done` : "no plan"),
        rule("gui", "The shop GUI was built with ui_build", guiBuilt, `${okCalls(calls, "ui_build").length} ui_build call(s)`),
        rule("server", "A server script was pushed to Studio", pushed(calls) >= 1, `${pushed(calls)} script push(es)`),
        rule("lint", "It passed a Luau lint before the push", linted(calls) >= 1, `${linted(calls)} passing lint(s)`),
        rule("playtest", "A playtest was started and its logs read", playtested(calls) && okCalls(calls, "roblox_get_playtest_logs").length > 0, `${okCalls(calls, "roblox_playtest_start").length} start, ${okCalls(calls, "roblox_get_playtest_logs").length} log read`),
      ];
    },
  },
  terrain: {
    title: "Island at sunset",
    prompt: "Create a small island with terrain, a few trees snapped to the ground, and a sunset sky with atmosphere. Compute the heightmap in the VM first, then check it with screenshots.",
    evaluate: (calls, plan) => {
      const items = plan?.items ?? [];
      return [
        rule("plan", "A plan was created and every item is done", !!plan && items.length >= 2 && items.every((i) => i.done), plan ? `${items.filter((i) => i.done).length}/${items.length} done` : "no plan"),
        rule("terrain", "Terrain was created (heightmap or fill)", usedHeightmapOrFill(calls) > 0, `${okCalls(calls, "terrain_heightmap").length} heightmap, ${okCalls(calls, "terrain_fill").length} fill`),
        rule("computed", "The heightmap was computed in the VM (vm_exec ran first)", okCalls(calls, "vm_exec").length > 0, `${okCalls(calls, "vm_exec").length} vm_exec call(s)`),
        rule("lighting", "Lighting was set", okCalls(calls, "lighting_set").length > 0, `${okCalls(calls, "lighting_set").length} lighting_set call(s)`),
        rule("snap", "Trees were snapped to the ground", okCalls(calls, "snap_to_ground").length > 0, `${okCalls(calls, "snap_to_ground").length} snap_to_ground call(s)`),
        rule("looked", "The result was looked at", okCalls(calls, "screenshot_multi").length + okCalls(calls, "roblox_screenshot").length > 0, `${okCalls(calls, "screenshot_multi").length} screenshot_multi`),
      ];
    },
  },
};

export function evaluate(test: string, calls: Call[], plan: Plan): Verdict {
  const t = TESTS[test]; if (!t) throw new Error("unknown test " + test);
  if (!calls.length) return { test, pass: false, ran: false, rules: [rule("ran", "The test has been run", false, "no tool calls recorded for this prompt")] };
  const rules = t.evaluate(calls, plan);
  return { test, pass: rules.every((r) => r.pass), rules, ran: true };
}
