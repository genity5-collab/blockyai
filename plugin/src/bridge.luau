--!strict
-- BlockyAI command bridge (plugin side). Pure logic, no Roblox services: everything Studio-specific is injected, so it is unit tested.
-- Responsibilities: (1) exactly-once from the plugin's side: a repeated idempotency key returns the stored result instead of running again,
-- (2) refuse mutating commands during a playtest, (3) ACK when a command starts and heartbeat while it runs, (4) feature detection.
local B = {}

-- ---------- 200-entry result cache keyed by idempotency key (oldest evicted first) ----------
export type Entry = { ok: boolean, result: any, error: string? }
export type Cache = { map: { [string]: Entry }, order: { string }, cap: number }

function B.newCache(cap: number?): Cache
	return { map = {}, order = {}, cap = cap or 200 }
end
function B.cacheGet(c: Cache, key: string?): Entry?
	if key == nil or key == "" then
		return nil
	end
	return c.map[key]
end
function B.cachePut(c: Cache, key: string?, entry: Entry)
	if key == nil or key == "" then
		return
	end
	if c.map[key] == nil then
		table.insert(c.order, key)
		while #c.order > c.cap do
			local old = table.remove(c.order, 1)
			c.map[old :: string] = nil
		end
	end
	c.map[key] = entry
end

-- ---------- commands that only read or control a playtest. Everything else changes the edit-mode DataModel. ----------
local READ_ONLY: { [string]: boolean } = {
	get_tree = true, find = true, get_selection = true, read_script = true, get_playtest_logs = true, get_edit_log = true,
	get_bounding_box = true, get_pivot = true, raycast = true, find_empty_space = true, measure_distance = true,
	screenshot = true, screenshot_multi = true, camera_set = true, snapshot_save = true, playtest_stop = true, template_load = true,
	playtest_start = true,
}
function B.isMutating(t: string): boolean
	return not READ_ONLY[t]
end
-- Returns an error message when `t` must not run now, else nil.
function B.guard(t: string, playtestActive: boolean): string?
	if playtestActive and B.isMutating(t) then
		return "refused: a playtest is running, and '" .. t .. "' would change the edit-mode game (the change would be lost or confuse the test). Call playtest_stop, wait for it to end, then retry."
	end
	return nil
end

-- ---------- one command, start to finish ----------
export type Env = {
	handlers: { [string]: (any, any?) -> any },   -- (payload, ctl) ctl.cancelled() is true after Stop
	allowed: { [string]: boolean },
	cache: Cache,
	playtestActive: () -> boolean,
	ack: (id: string) -> (),
	heartbeat: (id: string) -> boolean?,   -- the server's `alive`; false means the command was cancelled (Stop). nil/unknown is NOT a cancel.
	clock: () -> number,
	spawn: ((() -> ()) -> ())?,
	wait: ((number) -> ())?,
	beat_s: number?,
}
export type Outcome = { ok: boolean, result: any, error: string?, cached: boolean, refused: boolean }

-- The server answers a heartbeat with { alive = boolean }. alive=false means the command was cancelled (the user pressed Stop).
-- Returns false ONLY for a real boolean false with no transport error. Anything else (network error, junk, no answer) is nil = unknown,
-- and unknown never cancels work: a flaky connection must not abort a build.
function B.aliveFrom(data: any, err: any): boolean?
	if err ~= nil or type(data) ~= "table" then
		return nil
	end
	local a = (data :: any).alive
	if type(a) == "boolean" then
		return a
	end
	return nil
end

function B.execute(env: Env, c: any): Outcome
	local t = tostring(c.type)
	-- 1. Seen this idempotency key? Return the stored result. Never run it twice. Still ACK so the server stops waiting for us.
	local hit = B.cacheGet(env.cache, c.idempotency_key)
	if hit then
		env.ack(c.id)
		return { ok = hit.ok, result = hit.result, error = hit.error, cached = true, refused = false }
	end
	-- 2. Not on the allowlist (even if the server is compromised).
	if not env.allowed[t] or not env.handlers[t] then
		return { ok = false, result = nil, error = "command type not allowed: " .. t, cached = false, refused = true }
	end
	-- 3. Playtest guard: say why, do not just fail.
	local why = B.guard(t, env.playtestActive())
	if why then
		return { ok = false, result = nil, error = why, cached = false, refused = true }
	end
	-- 4. ACK before doing any work, so the agent can tell "busy" from "not responding".
	env.ack(c.id)
	-- 5. Heartbeat while it runs. A long build_model must not lose its lease.
	local running = true
	local stopped = false           -- becomes true when a heartbeat is answered with alive=false (the user pressed Stop)
	if env.spawn and env.wait then
		local spawn, wait = env.spawn, env.wait
		local beat = env.beat_s or 10
		spawn(function()
			while running do
				wait(beat)
				if running then
					local okBeat, alive = pcall(env.heartbeat, c.id)
					if okBeat and alive == false then
						stopped = true
					end
				end
			end
		end)
	end
	-- The handler gets a control object. Long handlers (build_model) call ctl.cancelled() between steps and stop early.
	-- It only turns true on an explicit alive=false answer: a missing/failed heartbeat never cancels work.
	local ctl = { cancelled = function(): boolean return stopped end }
	local handler = env.handlers[t]
	local ok, res = pcall(function()
		return handler(c.payload or {}, ctl)
	end)
	running = false
	local entry: Entry = { ok = ok, result = ok and res or nil, error = (not ok) and tostring(res) or nil }
	B.cachePut(env.cache, c.idempotency_key, entry)
	return { ok = ok, result = entry.result, error = entry.error, cached = false, refused = false }
end

-- ---------- feature detection: which APIs exist in THIS Studio. Each probe is pcall-wrapped by the caller-supplied `probe`. ----------
B.FEATURES = { "StudioTestService", "ExecutePlayModeAsync", "ExecuteRunModeAsync", "CaptureService", "Terrain.FillBlock", "Terrain.WriteVoxels", "ChangeHistoryService.Recording", "Raycast", "HttpService.RequestAsync", "Selection" }
function B.detect(probe: (string) -> boolean): { [string]: boolean }
	local out: { [string]: boolean } = {}
	for _, name in ipairs(B.FEATURES) do
		local ok, v = pcall(probe, name)
		out[name] = ok and v == true
	end
	return out
end

return B
