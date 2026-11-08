# BlockyAI: how the system works (for analysis)

Version: plugin v4, document updated 2026-11-07 (commit 8322fa7 plus later). Written in plain words. Every claim below comes from the code in the repo (github.com/genity5-collab/blockyai, branch main) or from a test that was run. Things that are NOT verified are listed at the end under "Unknowns". Please keep verified facts and unknowns separate in your answer.

## 1. What it is

BlockyAI is an AI assistant that builds and edits Roblox games from inside Roblox Studio. The user types a request in a web chat ("make a mega hard troll obby"). An AI agent plans the work, then changes the open game by calling tools. The agent runs in a Linux virtual machine (VM), one per chat session. It never touches Roblox directly. It can only act through a small Roblox Studio plugin that the user installs.

There are no user accounts. A browser gets an anonymous `client_id` (UUID) and a secret `client_key`, stored in localStorage and sent with every request. Whoever holds the key owns the session.

## 2. The four parts and how data moves

```
Website (React)  <->  Supabase (database + 19 edge functions)  <->  Agent in a Freestyle VM
                                      ^
                                      |  long-poll
                            Roblox Studio plugin (Luau)
```

1. **Website** (blockyai.onrender.com, static, built with Vite). Chat, plan checklist, 3D screenshot strip, templates tab, plugin page, diagnostics page (/#/diagnostics), capability tests page (/#/capability). It only holds the public anon key.
2. **Supabase**: Postgres plus 19 edge functions (Deno/TypeScript). It is the only shared meeting point. Tables: sessions, messages, commands, edit_log, playtest_logs, screenshots, snapshots, script_mirror, attachments, tool_calls, agent_plans, templates, plugin_releases.
3. **Agent**: Node.js program (`agent/src`, about 700 lines) running as a systemd service inside a Freestyle VM. One VM per session, booted from a saved snapshot. It talks to the AI model through an `llm-proxy` function and to everything else through edge functions, using a per-session token that expires.
4. **Plugin**: one Luau file (about 2,700 lines, built from modules in `plugin/src`) that the user pastes into Studio as a local plugin. It long-polls `plugin-poll`, runs allowed commands inside Studio, and posts results to `plugin-result`.

The website cannot call the Supabase functions directly in production. Render rewrites `/api/<name>` to the Supabase function. Every function the site or plugin calls needs its own rewrite (11 exist). A script `scripts/check-routes.sh` fails if one is missing.

### One request, step by step
1. User sends a chat message. `web-api` stores it in `messages` and starts the VM if needed (`vm-start` boots the snapshot and gives it a session token).
2. The agent loop reads the message, builds a prompt, calls the model through `llm-proxy`.
3. The model answers with up to 6 `<tool>{"name":..,"args":..}</tool>` blocks. The loop runs them in order and stops at the first failure.
4. A `roblox_*` tool inserts a row into `commands` (see the queue section below). The plugin's long-poll claims it (poll window 20 seconds, checks every 0.8s), acknowledges it, runs it in Studio while sending heartbeats, and posts the result. The agent waits for that result.
5. A `vm_*` tool runs inside the VM (shell, file read/write, Luau lint). It cannot change Studio.
6. Progress is written to `messages` and `tool_calls`; the website reads it live.
7. When the agent wants to stop, the loop asks the server "may I finish?" (section 5). If not, it is told what is missing and keeps working.

### The command queue (reliability upgrade, in production)

`commands` is a real Postgres queue. The logic lives in SQL functions (`supabase/migrations/0008_reliable_queue.sql`), not in TypeScript, so two pollers cannot race.

- **States:** `queued -> claimed -> running -> done | failed | cancelled | expired`. (The old state `pending` no longer exists; a bug where approve/reject/Stop still filtered on it was found by live testing and fixed, and a test now scans every function so it cannot return.)
- **Claiming:** `FOR UPDATE SKIP LOCKED`, oldest first, one command at a time per session so edits keep their order. A claim is a lease. If the plugin goes silent the lease runs out and the command is re-queued, up to a bounded number of attempts, then marked `expired`.
- **ACK and heartbeat:** the plugin calls `plugin-ack` when it starts a command and `plugin-heartbeat` while it runs, which extends the lease. Long builds therefore do not time out.
- **Idempotency:** every command has an idempotency key. Enqueueing the same key twice returns the first row. The plugin also keeps its last 200 results and replays the stored result instead of running a command twice.
- **Size cap:** a payload over 64 KB is refused at enqueue.
- **Risk tiers and approval (`supabase/functions/_shared/policy.js`):** every command gets a tier. HIGH = `delete`, `snapshot_restore`, `run_lua`. MEDIUM = creating/writing things (`create`, `write_script`, `patch_script`, `build_model`, `ui_build`, `terrain_*`, `duplicate_*`, and any command not on the read-only list). LOW = `set_properties`, `move`, `align`, reads. Batches are expanded into their sub-commands BEFORE classifying (to depth 3, deeper is treated as high), so a batch cannot hide a HIGH step. **A tier alone does not stop a command.** Approval (`needs_confirm = true`, command held until the owner clicks Allow in the website or plugin) is required only when: `run_lua` (always); `snapshot_restore` (until restore is proven by a real run, `RESTORE_VERIFIED`); a `delete` of more than 10 instances; a `delete` of a top-level service child (Workspace, ServerScriptService, ...); a `delete` of a script; or a `delete` whose target is unclear. So a delete of 10 or fewer ordinary instances runs WITHOUT approval (it is auto-snapshotted first). Rejecting cancels the command. The plugin's approval card shows the reasons.
- **Taint rule (partly built):** the classifier takes a `tainted` flag, and when set, EVERY high action needs approval. The flag is read from `sessions.tainted`, but **nothing in the code sets it to true yet**, so the rule exists and never fires. This is a real gap.
- **Stop:** cancels everything in `queued`, `claimed` and `running`.
- **Permissions:** the queue functions are callable only by the server (service role). The public anon key cannot execute them (this was a hole that was found and closed).
- **Playtest guard:** while a playtest is running the plugin refuses edit commands with a reason instead of changing the live test.

### The plugin (v4)

One Luau file built from modules. It reports its Studio version and which engine features exist (for example `StudioTestService`) when it pairs; the server sanitizes that input. The Settings tab has a **Run self-test** button: with no AI involved it builds a model, writes and reads a script, builds UI, fills terrain, changes lighting, saves a snapshot, runs a playtest and undoes, then removes everything it made and posts a per-step pass / fail / skip report. The website's `/#/diagnostics` page shows the Studio version, features, last contact, command counts and the latest self-test reports exactly as received.

## 3. Tools (53)

Two families, enforced by name and by a routing policy in the prompt:

- **roblox_\*** (18): change or inspect the live game. get_tree, find, set_properties, create, delete, move, read/write/patch_script, batch, playtest_start/stop, get_playtest_logs, screenshot, snapshot_save/restore, get_selection, get_edit_log.
- **vm_\*** and friends: vm_exec, vm_read_file, vm_write_file, vm_lint_luau, sync_mirror (copy scripts from Studio into the VM), push_changed (send only modified scripts back). The VM has no Roblox engine; it cannot prove that Roblox code works.
- **Building** (run inside the plugin as one command each): build_model (a JSON spec of parts, cylinders, wedges, hinges etc. becomes a model), build_from_template, template_save/load, duplicate_array/grid/along_path, mirror, scale_model, align, distribute, snap_to_ground, get_bounding_box, get_pivot, raycast, find_empty_space, measure_distance, camera_set, screenshot_multi, terrain_fill, terrain_heightmap, lighting_set, ui_build, insert_asset, batch_refs.
- **Planning**: plan_create, plan_update.
- **Local**: local_grep, local_lint.

The plugin has an allowlist of command types. `run_lua` (arbitrary code) is off by default and needs the user to enable it. Which commands wait for a human is decided by the risk tier (see the queue section), not by a fixed list of two. Destructive commands such as `delete` and `batch` are also auto-snapshotted first but run WITHOUT asking, so a bad agent decision can delete things until the user restores the snapshot. That is a real gap, not a feature.

## 4. The prompt

The system prompt is about 18,000 characters: the loop rules, `prompts/vm-policy.md` (which tool family to use when), `prompts/building-guide.md` (proportions, order of work, paths), `prompts/game-builder.md` (a 6-step game workflow: plan in NOTES.md, scaffold, build systems with linted code, build the world, verify, report), then the tool list. The loader refuses to start if a prompt file is missing or lacks required keywords.

## 5. Safety and honesty rules (what is enforced in code vs only asked in the prompt)

Enforced in code:
- **Finish gate** (server-side, `agent-plan`): the agent cannot finish while any plan item is not done, while no item is marked verified, or while the named target container has fewer than 5 descendants. The loop calls `can_finish` and obeys. It stops asking after 6 rejections.
- **Iteration cap**: default 40 tool-loops, hard cap 80.
- **Stop on error**: a failing tool ends the run and shows the raw error. Hard failures (plugin not responding, 401, VM not running) end it immediately; other failures end it after 4 in a row.
- **Lint gate**: roblox_write_script lints locally first (luau-lsp with Roblox types plus stylua) and refuses code that fails.
- **Untrusted data**: text from the game, from VM output and from attachments is wrapped (`<untrusted_game_data>`, `<attachment>`) and the prompt says to treat it as data. This is a prompt-level defense plus tag stripping; it is not a proof against prompt injection.
- **Secrets**: Freestyle and model keys exist only as Supabase secrets. The plugin and website contain no keys. The plugin never downloads or runs remote code; the server sends only data (commands for an allowlist, a validated JSON theme, a version number).
- **Models**: all calls go through Free.ai self-hosted models only.

Only asked in the prompt (not enforced): "never invent a tool result", "say what you verified and did not", "write a note before editing".

## 6. The capability tests (/#/capability)

Five tests send a real build request to the agent and then judge the RECORDED tool calls on the server, not the agent's words. A test passes only if every rule is proven by `tool_calls` evidence: yacht (40+ instances, 0 errors, plan done, a verified item, looked at), house (built, door script pushed, linted, looked at), obby (2+ scripts pushed and linted, playtest, logs read), shop (ui_build, server script pushed and linted, playtest and logs), island (heightmap computed in the VM, lighting set, trees snapped, looked at). Each failing rule shows its evidence. The judge has 9 unit assertions and 6 house-test regression tests.

## 7. Test and deploy status (what was actually run)

- Agent: 79 tests pass locally (before the raw-body work below). On the VM, 63 pass (the 10 acceptance tests need server files that the VM does not have, so they run only in the repo).
- Site: 26 render tests pass.
- Plugin logic: builder 43, transform 39, uibuild 13, ui 28, reference 28, resolve 9, bridge 49, selftest 46 pass (255 checks), run on a Freestyle VM against a MOCK Roblox engine. The plugin passes `luau-lsp` strict analysis with 0 errors.
- Live checks done: 19 functions deployed and enforcing auth; version check works through the site; the plugin file served by the site is byte-identical to the build; a VM booted from the current snapshot has the 53 tools, the 3 prompts, 6 templates, 9 reference specs, the Roblox type definitions and all 4 lint tools.

- Queue: 16 tests run against a REAL Postgres (concurrency, ordering, lease expiry, idempotency, size cap, risk tiers). Live end-to-end checks on the production database confirmed pairing sanitizes hostile input, a 12-instance delete is held until approved, rejecting cancels it, Stop cancels queued and running work, a self-test report clamps hostile fields, and another owner's key gets 404.
- Database exposure: all 14 tables have row-level security. The Supabase anon key appears in old git history (it is public by design). It was tested: it reads 0 rows from every table, cannot write, and cannot execute any database function.

## 8. Bugs found and fixed (real failures)

1. **`roblox_create ... parent: "Game"` failed with "parent not found".** Cause: the plugin's path walker skipped only a lowercase `game` first segment. Fix: it now accepts `Game`, `game`, `DataModel`, and bare service names. 9 tests. The building guide now says to create things inside existing services and never to invent a parent called "Game".
2. **`plan_update` failed with "no item #Create ServerScriptService/Services folder structure".** Cause: the model sent the checklist item's TEXT as `id`, but items are numbered 1..N. Fix: `findItem` accepts a number, "#3", the exact text, or a unique text fragment; an ambiguous reference matches nothing (it never guesses) and the error now lists all items with their numbers so the model can correct itself. Verified on the live function with the exact failing payload (200 OK), and the ambiguous case returns a helpful 400.
3. The site had no `/api` route for `plugin-chat`, `plugin-register` and `capability-test` (calls silently returned empty). Routes added; a script now checks it.
4. The plugin used GET for the version check, which the site proxy does not forward. Changed to POST.
5. Four of six stored GitHub tokens were dead. The valid one was used.
6. **Approve, reject and Stop did nothing** after the queue rewrite, because three functions still filtered on the removed state `pending`. Found by a live end-to-end test, fixed in `web-api` and `plugin-chat`, and guarded by `tests/no-stale-status.test.mjs`.
7. The first live test sent the wrong owner-key hash and reported failures that were really a test bug; fixing the test (not the code) was the correct response. Mentioned because it shows the tests can be wrong too.
8. The queue functions were executable with the public key. Revoked; verified with the real key.
9. **The AI answered a real question with only "Working..." and stopped.** Cause: while it works, the loop writes a "Working..." line into the chat; on the next turn that line is replayed to the model as something it said, and the model (3 tokens, 10 characters) copied it as its whole reply. Found from `llm_calls` (3 completion tokens, finish_reason stop). Fix, without touching `agent/`: `agent-messages` no longer returns assistant rows that are only a "Working..."/"Thinking..." placeholder (`_shared/placeholders.js`, 6 tests). Verified live: the same question now gets a full answer. A better fix in `agent/src/index.js` (do not replay placeholder rows) belongs to Claude.
10. **The AI's last screen picture was never deleted.** Deleting a session, or pausing or destroying its VM, left the picture in the private `screen` bucket forever. Fix: `_shared/clearscreen.js` removes the files and the frame row (10 tests); verified live for session deletion. Not yet run live for the VM stop and idle sweep. My own earlier test cleanup had also never worked (SQL cannot delete storage files; only the Storage API can), which left 13 orphan pictures; removed.
11. **On phones the whole page was 468px wide on a 390px screen**, so the browser zoomed everything out and the view looked broken. Causes: the top bar (long account name) and the bottom status row. Fixed with CSS only; measured in a real Chrome at 390, 360 and 320px wide (page width equals the screen), and the Desktop-site and laptop layouts are unchanged. Not tested on a real phone.
12. Installing tools on demand already works: on a fresh VM from the live image `sudo` works, npm, apt and binary downloads from GitHub finish in 1 to 2 seconds, 24 GB free. `pip install --user` fails inside the virtualenv; plain `pip install` works. The prompt could say so (belongs to Claude).

Pattern worth noticing: the model repeatedly makes small interface mistakes (wrong parent name, text instead of id). The fix each time was to make the tool tolerant and make the error message tell the model exactly how to correct itself.

## 9. Unknowns (NOT verified; please do not assume they work)

- **No end-to-end run in a real Roblox Studio has been verified by me.** All plugin tests use a mock engine. Whether the real Roblox API accepts every property/enum used by build_model, terrain_heightmap, ui_build, etc. is unproven.
- **Real screenshots**: the plugin tries `StudioCaptureService` (Studio asks the user to allow it) and falls back to a text "scene report". Not tested in a real Studio.
- **Playtests** use `StudioTestService` (single-player only). Not tested live.
- **The 5 capability tests have never been run against a real paired Studio**, so none is proven to pass.
- **Model quality**: whether the self-hosted model reliably follows a 18,000-character prompt, makes valid build_model specs, and stays inside 40 iterations is unmeasured. The mistakes in section 8 suggest it needs forgiving tools.
- **Latency/cost**: each tool call is a database round trip plus a 0.8s polling interval; big builds may be slow. Not measured.
- **Not supported**: CSG unions, MeshParts from a spec, multiplayer Team Test, anything the Studio plugin API does not expose.
- **Prompt-injection defense** is tag wrapping plus instructions; not red-teamed.
- **Idle-suspend scheduling** of VMs is still pending, so a VM may keep running until stopped or its TTL ends.

- **Not built yet (planned in the reliability upgrade):** raw-body tool calls are NOT in the repo yet (a first draft of the parser was written locally but has no tests and is not committed); the agent loop does not use them, so scripts still travel as escaped JSON. There is no shared tool schema or argument normalizer yet (tools are declared as `{ args: "<free text>", run }`, so wrong argument shapes are caught late). Setting the taint flag (the rule that uses it exists, see the queue section), script backups before overwrite, finish-gate evidence checks and per-session quotas are NOT done. Fuzz, replay and Roblox API-dump tests are NOT done.
- **Studio file link (sync_mirror / push_changed)**: built and tested with a mock engine only. A real plugin (v4) connected once (Nov 7, 18 commands, 15 done, the 2 failures were correct refusals to set Position on a Folder) and has not been seen since; no real screenshot has ever been stored (0 rows). `sync_mirror` is capped at 100 scripts per class per root and skips names containing dots or slashes.
- **The self-test has never been pressed in a real Studio.** Everything about plugin behaviour is still verified only against a mock engine plus Luau analysis.

## 10. Where to look in the code

| Question | File |
|---|---|
| The agent loop, finish gate, system prompt | `agent/src/loop.js` |
| All tool definitions and routing | `agent/src/tools.js`, `agent/src/tools-build.js` |
| Plan storage and finish rules | `supabase/functions/agent-plan/index.ts` |
| Pass/fail judge for capability tests | `supabase/functions/_shared/acceptance.ts` |
| Plugin command handlers and path resolution | `plugin/src/main.luau`, `studio_cmds.luau` |
| Plugin bridge (ACK, heartbeat, result cache, playtest guard) | `plugin/src/bridge.luau` |
| In-Studio self-test | `plugin/src/selftest.luau` |
| Queue SQL (claim, ack, heartbeat, finish, risk) | `supabase/migrations/0008_reliable_queue.sql` |
| Raw-body tool calls | not built yet |
| Model builder | `plugin/src/builder.luau` |
| Prompts | `agent/prompts/*.md` |
| Deploy / bake VM / route check | `scripts/bake-vm.mjs`, `scripts/check-routes.sh` |

## 11. Questions for you (Claude)

1. What are the weakest points in this design, ranked by how likely they are to break a real user build?
2. Is a database-row-per-command, long-poll bridge to Studio sound, or should something change for speed and reliability?
3. Which of the "enforced in code" safety rules have gaps (for example: is the risk tier list complete, and can the agent split one big delete into small ones to stay under the threshold?)? Which "only asked" rules should become code?
4. How should the tools be made more forgiving so a mid-quality model succeeds more often?
5. What tests would you add that do NOT depend on a real Studio, and what is the smallest real-Studio test that would prove the most?
