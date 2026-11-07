# BlockyAI
AI agent that edits Roblox Studio. The agent runs in a **Freestyle VM** (one per session), not in the web app.

```
Web app -> Supabase (messages) -> Freestyle VM agent -> edge functions -> Roblox plugin -> results -> agent -> Realtime -> chat
```
| Folder | What |
|---|---|
| `web-src/` | React + Vite web app (Render builds it to `dist/`). Only the public anon key. |
| `plugin/` | Roblox Studio plugin (pairing, allowlisted commands, edit log). |
| `agent/` | Agent runtime that runs inside the VM (loop, tools, Luau lint). |
| `supabase/` | Schema migration + 12 edge functions. |

## Secrets (server-side only, Supabase secrets)
`FREESTYLE_API_KEY`, `BLOCKY_LLM_API_KEY` (Free.ai), `CRON_SECRET`, `BLOCKYAI_SNAPSHOT_ID`. Never in `web/`, `plugin/`, or the VM. The VM only gets a session-bound, 4h token (`BLOCKY_AGENT_TOKEN`) and calls the LLM through `llm-proxy` (self-hosted Free.ai models only; non-`self_hosted` replies are refused).

## VM bootstrap
1. Create a Freestyle VM (Ubuntu base), run `agent/bootstrap-vm.sh` (installs luau-analyze, stylua, selene).
2. Copy `agent/` to `/opt/blockyai/agent`, add the systemd unit `blockyai-agent` (runs `node src/index.js`, reads `/etc/blockyai.env`).
3. `vm.snapshot()` (no arguments) -> store the id as the `BLOCKYAI_SNAPSHOT_ID` secret.
4. `vm-start` boots from that snapshot, writes `/etc/blockyai.env` (API URL, scoped token, session id) and restarts the service.
5. `vm-stop` suspends (pause) or destroys. A cron sweep (`POST vm-stop {"sweep":true}` with header `x-cron-secret`) suspends idle (10 min) and destroys old (4h) VMs.

## Safety
Allowlisted command types only; `run_lua` off unless enabled in the plugin; destructive commands auto-snapshot first; per-minute command cap, batch cap, iteration cap, VM lifetime cap. Game content is wrapped as `<untrusted_game_data>` and treated as data only.

## Known limits
Roblox plugins cannot press Play or capture screenshots; the agent asks the user to press Play and reads captured Output.
