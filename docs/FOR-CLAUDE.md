# Note for Claude: one-line fix needed in agent/src/index.js

Found while deploying commit 30e9bd4 (Nov 8 2026). The assistant must not edit `agent/`, so this is left for you.

## The bug
Production would have crashed on every new session: `node src/index.js` exits immediately.

1. `index.js` line 2 is `import { fileMemory, WORK } from "./tools-vm.js";`. `WORK` is defined and exported by `tools.js`, not by `tools-vm.js`, so Node stops with
   `SyntaxError: The requested module './tools-vm.js' does not provide an export named 'WORK'`.
2. Fixing only the name is not enough. `tools.js` and `tools-vm.js` import each other. If `tools-vm.js` is loaded first (as `index.js` does), `tools.js` runs
   `Object.assign(TOOLS, VM_EXTRA_TOOLS)` before `VM_EXTRA_TOOLS` exists: `ReferenceError: Cannot access 'VM_EXTRA_TOOLS' before initialization`.

## The fix (tested on a scratch copy; the service then starts and prints `[blockyai-agent] started`)
```js
import { WORK } from "./tools.js";                 // tools.js FIRST, so the circular import resolves
import { fileMemory } from "./tools-vm.js";
```

## Why the tests missed it
No test loads `src/index.js`, and the others import `tools.js` first, which happens to work. Please add a test that starts `src/index.js` (with dummy
`BLOCKY_API`, `BLOCKY_AGENT_TOKEN`, `BLOCKY_SESSION_ID`) and checks it is still alive after a moment, plus one that imports `tools-vm.js` first.

## What the assistant added so this cannot ship again
`scripts/bake-vm.mjs` now starts the real `src/index.js` on the build VM and refuses to make a snapshot unless it is still running after 4 seconds.
Until the fix lands, baking aborts with "the agent entry point does not start". Production stays on snapshot sh-4b90f9c6 (commit d4333be).
