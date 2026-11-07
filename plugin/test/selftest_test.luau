local Mock = require("./mock")
local env0 = setmetatable({}, { __index = _G })
Mock.install(env0)
local fn = assert(loadstring(require("./selftest_src") :: string, "@selftest"))
setfenv(fn, env0)
local S = fn()

local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail ~= nil and (" :: " .. tostring(detail)) or "")) end
end

-- runner: one failing step does not stop the rest; raw error is kept
do
	local cleaned = false
	local ctx = { cleanup = function() cleaned = true end }
	local steps = {
		{ name = "a", run = function() return { ok = 1 } end },
		{ name = "b", run = function() error("raw failure text") end },
		{ name = "c", run = function() return "fine" end },
	}
	local r = S.run(steps, ctx, nil, function() return 0 end)
	check("all three steps ran", #r.steps == 3)
	check("counts: 2 pass 1 fail", r.passed == 2 and r.failed == 1 and r.skipped == 0)
	check("failure carries the RAW error", r.steps[2].status == "fail" and string.find(r.steps[2].error :: string, "raw failure text") ~= nil)
	check("step after a failure still ran", r.steps[3].status == "pass")
	check("cleanup ran", cleaned and r.cleaned)
end

-- missing feature => skip (not fail), with the reason
do
	local ran = false
	local steps = { { name = "terrain", requires = "Terrain.WriteVoxels", run = function() ran = true end } }
	local r = S.run(steps, {}, { ["Terrain.WriteVoxels"] = false }, function() return 0 end)
	check("step skipped when feature missing", r.steps[1].status == "skip" and r.skipped == 1 and r.failed == 0)
	check("skipped step did not run", ran == false)
	check("skip says why", string.find(r.steps[1].error :: string, "Terrain.WriteVoxels") ~= nil)
	local r2 = S.run(steps, {}, { ["Terrain.WriteVoxels"] = true }, function() return 0 end)
	check("step runs when feature present", ran == true and r2.steps[1].status == "pass")
	ran = false
	local r3 = S.run(steps, {}, nil, function() return 0 end)
	check("unknown features: step still tries", ran == true)
end

-- fallback is reported as 'fallback', counted as passed, never as a real pass
do
	local steps = { { name = "shot", run = function() return { fallback = true, kind = "scene report" } end } }
	local r = S.run(steps, {}, nil, function() return 0 end)
	check("fallback status is explicit", r.steps[1].status == "fallback" and r.passed == 1)
end

-- cleanup runs even if EVERY step failed, and a failing cleanup is reported, not hidden
do
	local cleaned = 0
	local steps = { { name = "x", run = function() error("e1") end }, { name = "y", run = function() error("e2") end } }
	local r = S.run(steps, { cleanup = function() cleaned += 1 end }, nil, function() return 0 end)
	check("cleanup ran after total failure", cleaned == 1 and r.failed == 2 and r.cleaned)
	local r2 = S.run(steps, { cleanup = function() error("could not delete SelfTestModel") end }, nil, function() return 0 end)
	check("cleanup failure is reported", r2.cleaned == false and string.find(r2.cleanup_error :: string, "could not delete") ~= nil)
	local r3 = S.run({}, {}, nil, function() return 0 end)
	check("no cleanup function is fine", r3.cleaned == true)
end

-- timing
do
	local t = 0
	local clock = function() t += 0.25 return t end
	local r = S.run({ { name = "t", run = function() return 1 end } }, {}, nil, clock)
	check("duration recorded in ms", r.steps[1].ms == 250, r.steps[1].ms)
end

-- the real step list: names and ordering required by the spec; every step has a run function
do
	local steps = S.steps()
	local names = {}
	for _, s in ipairs(steps) do table.insert(names, s.name) check("step has run(): " .. s.name, type(s.run) == "function") end
	local joined = table.concat(names, "|")
	for _, need in ipairs({ "HTTP reachability", "build_model", "script write", "ui_build", "terrain_heightmap", "lighting_set", "camera_set", "screenshot", "snapshot", "playtest", "ChangeHistory" }) do
		check("self-test includes: " .. need, string.find(joined, need, 1, true) ~= nil)
	end
	local function idx(n: string): number for i, s in ipairs(steps) do if string.find(s.name, n, 1, true) then return i end end return -1 end
	check("order: HTTP first", idx("HTTP") == 1)
	check("order: build_model before ui_build", idx("build_model") < idx("ui_build"))
	check("order: playtest before ChangeHistory", idx("playtest") < idx("ChangeHistory"))
	check("terrain and playtest declare required features", steps[idx("terrain")].requires == "Terrain.WriteVoxels" and steps[idx("playtest")].requires == "StudioTestService")
end

-- run the REAL step list against a fake ctx to prove the steps wire to handlers correctly and that restore/undo comparisons catch a bad engine
do
	local function mkCtx(restoreWorks: boolean, undoWorks: boolean)
		local count, snapCount = 5, 0
		local tracked = {}
		local ctx: any = { root = "Workspace.__SelfTest", kitchenSink = {}, uiSpec = {}, wait = function() end }
		ctx.encode = function(v)
			if type(v) ~= "table" then return tostring(v) end
			local parts = {}
			for k, x in pairs(v) do table.insert(parts, tostring(k) .. "=" .. (type(x) == "table" and ctx.encode(x) or tostring(x))) end
			return "{" .. table.concat(parts, ",") .. "}"
		end
		ctx.http = function() return { latest = 3 }, 200 end
		ctx.track = function(p) table.insert(tracked, p) end
		ctx.countDescendants = function() return count end
		ctx.undo = function() if undoWorks then count -= 1 end end
		ctx.clearTerrain = function() end
		ctx.restoreLighting = function() end
		ctx.saveLighting = function() return {} end
		ctx.h = {
			build_model = function() count += 12 return { instances = 12, errors = {} } end,
			write_script = function() count += 1 return { ok = true } end,
			read_script = function() return { source = "print('blockyai selftest ' .. 1 + 1)\n" } end,
			ui_build = function() count += 4 return { instances = 4, errors = {} } end,
			terrain_heightmap = function() return { ok = true } end,
			lighting_set = function() return { changed = { "Lighting.Brightness", "Lighting.ClockTime" } } end,
			camera_set = function() return { ok = true } end,
			screenshot = function() return { scene_report = "..." } end,
			snapshot_save = function() snapCount = count return { id = "s1" } end,
			create = function() count += 1 return { ok = true } end,
			snapshot_restore = function() if restoreWorks then count = snapCount end end,
			playtest_start = function() return { started = true } end,
			get_playtest_logs = function() return { lines = { "x", "SELFTEST_MARKER_42" } } end,
			playtest_stop = function() return {} end,
		}
		ctx.cleanup = function() end
		return ctx, tracked
	end
	local good = S.run(S.steps(), mkCtx(true, true), nil, function() return 0 end)
	local gf = {} for _, s in ipairs(good.steps) do if s.status == "fail" then table.insert(gf, s.name .. ": " .. tostring(s.error)) end end
	check("real steps pass against a correct fake engine", good.failed == 0, table.concat(gf, " ; "))
	local shot
	for _, s in ipairs(good.steps) do if string.find(s.name, "screenshot", 1, true) then shot = s end end
	check("scene-report screenshot is labelled fallback", (shot :: any).status == "fallback")
	local bad = S.run(S.steps(), mkCtx(false, true), nil, function() return 0 end)
	local restoreFailed = false
	for _, s in ipairs(bad.steps) do if string.find(s.name, "snapshot", 1, true) and s.status == "fail" and string.find(s.error :: string, "restore did not return") then restoreFailed = true end end
	check("a restore that does not restore is CAUGHT by the snapshot step", restoreFailed)
	local bad2 = S.run(S.steps(), mkCtx(true, false), nil, function() return 0 end)
	local undoFailed = false
	for _, s in ipairs(bad2.steps) do if string.find(s.name, "ChangeHistory", 1, true) and s.status == "fail" then undoFailed = true end end
	check("an undo that does not undo is CAUGHT", undoFailed)
end

do
	-- a lighting property the engine rejects must FAIL the step (the handler reports it in `changed`, it does not throw)
	local ctx: any = { saveLighting = function() return {} end, restoreLighting = function() end, h = { lighting_set = function() return { changed = { "Lighting.Brightness", "Lighting.Bogus FAILED: not a valid member" } } end } }
	local step
	for _, s in ipairs(S.steps()) do if s.name == "lighting_set" then step = s end end
	local r = S.run({ step :: any }, ctx, nil, function() return 0 end)
	check("rejected lighting property fails the step with the raw reason", r.failed == 1 and string.find(r.steps[1].error :: string, "not a valid member") ~= nil, r.steps[1].error)
end

print(string.format("selftest: %d passed, %d failed", passed, failed))
if failed > 0 then error("selftest tests failed") end
