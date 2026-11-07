local Mock = require("./mock")
local env0 = setmetatable({}, { __index = _G })
Mock.install(env0)
local fn = assert(loadstring(require("./bridge_src") :: string, "@bridge"))
setfenv(fn, env0)
local B = fn()

local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail ~= nil and (" :: " .. tostring(detail)) or "")) end
end

local function mkEnv(over: any?)
	local log: { string } = {}
	local runs = { n = 0 }
	local e: any = {
		handlers = {
			get_tree = function() runs.n += 1; return { nodes = 3 } end,
			create = function(p) runs.n += 1; return { made = p.name } end,
			boom = function() error("kaboom") end,
			slow = function() runs.n += 1; return "slow done" end,
		},
		allowed = { get_tree = true, create = true, boom = true, slow = true, delete = true },
		cache = B.newCache(200),
		playtestActive = function() return false end,
		ack = function(id) table.insert(log, "ack:" .. id) end,
		heartbeat = function(id) table.insert(log, "hb:" .. id) end,
		clock = os.clock,
	}
	if over then for k, v in pairs(over) do e[k] = v end end
	return e, log, runs
end

-- exactly-once from the plugin side
do
	local e, log, runs = mkEnv()
	local c = { id = "c1", type = "create", payload = { name = "Wall" }, idempotency_key = "k1" }
	local r1 = B.execute(e, c)
	local r2 = B.execute(e, { id = "c1b", type = "create", payload = { name = "Wall" }, idempotency_key = "k1" })
	check("first run executes", r1.ok and r1.result.made == "Wall" and not r1.cached)
	check("repeated key does NOT run the handler again", runs.n == 1, runs.n)
	check("repeated key returns the stored result", r2.cached and r2.ok and r2.result.made == "Wall")
	check("repeated key still ACKs so the server stops waiting", log[#log] == "ack:c1b")
	-- a failed result is also stored and returned (no retry of a failing build)
	local f1 = B.execute(e, { id = "f1", type = "boom", payload = {}, idempotency_key = "kb" })
	local f2 = B.execute(e, { id = "f2", type = "boom", payload = {}, idempotency_key = "kb" })
	check("error is captured, not thrown", f1.ok == false and string.find(f1.error :: string, "kaboom") ~= nil)
	check("error result is replayed from cache", f2.cached and f2.ok == false and f2.error == f1.error)
	-- no key = never cached
	B.execute(e, { id = "n1", type = "get_tree", payload = {} })
	B.execute(e, { id = "n2", type = "get_tree", payload = {} })
	check("no idempotency key: always runs", runs.n == 3, runs.n)
end

-- cache bound: only the LAST 200 are kept
do
	local c = B.newCache(200)
	for i = 1, 250 do B.cachePut(c, "k" .. i, { ok = true, result = i }) end
	check("cache holds exactly 200", #c.order == 200)
	check("oldest 50 evicted", B.cacheGet(c, "k1") == nil and B.cacheGet(c, "k50") == nil)
	check("newest 200 kept", (B.cacheGet(c, "k51") :: any).result == 51 and (B.cacheGet(c, "k250") :: any).result == 250)
	B.cachePut(c, "k250", { ok = true, result = "again" })
	check("re-putting a key does not grow the cache", #c.order == 200)
	check("empty / nil key is ignored", B.cacheGet(c, nil) == nil and B.cacheGet(c, "") == nil)
end

-- ACK happens BEFORE the work
do
	local order: { string } = {}
	local e = mkEnv({
		ack = function() table.insert(order, "ack") end,
		handlers = { get_tree = function() table.insert(order, "work"); return {} end },
	})
	B.execute(e, { id = "a", type = "get_tree", payload = {} })
	check("ACK is sent before the handler runs", order[1] == "ack" and order[2] == "work", table.concat(order, ","))
end

-- heartbeat while running. The fake scheduler is cooperative and BOUNDED: spawn() stores the loop, wait() advances a fake clock, and the
-- handler (which runs while the command is "in flight") drives the stored loop for exactly N ticks by making wait() stop it.
do
	local beats, loopFn, ticks = 0, nil :: any, 0
	local e = mkEnv({
		heartbeat = function() beats += 1 end,
		beat_s = 10,
		spawn = function(f) loopFn = f end,
	})
	local TICKS = 3
	e.wait = function(_) ticks += 1 if ticks > TICKS then error("tick budget exhausted") end end
	e.handlers = { slow = function()
		-- the command is running right now: run the heartbeat loop for TICKS beats, then it errors out of the bounded wait
		pcall(loopFn)
		return "done"
	end }
	e.allowed = { slow = true }
	local out = B.execute(e, { id = "h", type = "slow", payload = {} })
	check("slow handler finished ok", out.ok and out.result == "done")
	check("heartbeats were sent while it ran (one per tick)", beats == TICKS, beats)
end
do
	-- after the command finished the loop must send NO more beats
	local beats, loopFn = 0, nil :: any
	local e = mkEnv({ heartbeat = function() beats += 1 end, spawn = function(f) loopFn = f end })
	e.wait = function(_) end
	e.handlers = { quick = function() return 1 end }
	e.allowed = { quick = true }
	B.execute(e, { id = "q", type = "quick", payload = {} })
	loopFn()   -- running is already false, so this must return immediately (bounded: if it spun, the test would hang)
	check("no heartbeat after the command finished", beats == 0, beats)
end

-- playtest guard
do
	local e, _, runs = mkEnv({ playtestActive = function() return true end })
	local r = B.execute(e, { id = "p1", type = "create", payload = { name = "X" } })
	check("mutating command refused during a playtest", r.ok == false and r.refused == true)
	check("refusal explains WHY and what to do", string.find(r.error :: string, "playtest is running") ~= nil and string.find(r.error :: string, "playtest_stop") ~= nil)
	check("handler was not run", runs.n == 0)
	local d = B.execute(e, { id = "p2", type = "delete", payload = {} })
	check("delete refused during a playtest", d.refused == true)
	local ok = B.execute(e, { id = "p3", type = "get_tree", payload = {} })
	check("read-only command still allowed during a playtest", ok.ok == true and runs.n == 1)
	for _, t in ipairs({ "create", "delete", "write_script", "patch_script", "build_model", "set_properties", "move", "terrain_fill", "terrain_heightmap", "lighting_set", "ui_build", "insert_asset", "snapshot_restore", "run_lua", "batch" }) do
		check("mutating: " .. t, B.isMutating(t) == true)
	end
	for _, t in ipairs({ "get_tree", "find", "read_script", "get_playtest_logs", "screenshot", "playtest_stop", "snapshot_save" }) do
		check("read-only: " .. t, B.isMutating(t) == false)
	end
	check("guard returns nil when no playtest", B.guard("create", false) == nil)
end

-- allowlist
do
	local e = mkEnv()
	local r = B.execute(e, { id = "z", type = "format_disk", payload = {} })
	check("unknown command refused locally", r.ok == false and r.refused and string.find(r.error :: string, "not allowed") ~= nil)
end

-- feature detection never throws and reports false for missing APIs
do
	local f = B.detect(function(name: string): boolean
		if name == "CaptureService" then error("no such service") end
		return name ~= "Terrain.WriteVoxels"
	end)
	check("probe error => false, not a crash", f.CaptureService == false)
	check("missing API => false", f["Terrain.WriteVoxels"] == false)
	check("present API => true", f.StudioTestService == true and f.Raycast == true)
	local n = 0 for _ in pairs(f) do n += 1 end
	check("every feature is reported", n == #B.FEATURES, n)
end

print(string.format("bridge: %d passed, %d failed", passed, failed))
if failed > 0 then error("bridge tests failed") end
