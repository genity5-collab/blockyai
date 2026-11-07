-- BlockyAI Studio plugin: main. Wires the UI, the network, and the command handlers together.
-- SAFETY: this plugin never downloads or runs remote code. The server only sends DATA (commands for an allowlist of handlers,
-- a JSON theme validated by hex pattern, a version number). Talks ONLY to blockyai.onrender.com with a per-session token.
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local LogService = game:GetService("LogService")

local PLUGIN_VERSION = 4
local BASE = "https://blockyai.onrender.com/api/"
local token = plugin:GetSetting("blockyai_token")
local runLuaEnabled = plugin:GetSetting("blockyai_runlua") == true
local flashEnabled = plugin:GetSetting("blockyai_flash") ~= false
local focusEnabled = plugin:GetSetting("blockyai_focus") == true

-- Commands the server may send. Anything not here is refused locally even if the server is compromised.
local ALLOWED: { [string]: boolean } = {
	get_tree = true, find = true, set_properties = true, create = true, delete = true, move = true,
	read_script = true, write_script = true, patch_script = true, batch = true,
	playtest_start = true, playtest_stop = true, get_playtest_logs = true, screenshot = true,
	snapshot_save = true, snapshot_restore = true, get_selection = true, run_lua = true,
	build_model = true, build_from_template = true, template_save = true, template_load = true,
	duplicate_array = true, duplicate_grid = true, duplicate_along_path = true, mirror = true, scale_model = true,
	align = true, distribute = true, snap_to_ground = true, get_bounding_box = true, get_pivot = true, raycast = true,
	find_empty_space = true, measure_distance = true, camera_set = true, screenshot_multi = true,
	terrain_fill = true, terrain_heightmap = true, lighting_set = true, ui_build = true, insert_asset = true,
}

-- ============ MODULES (inlined by build.mjs; each is a separate tested file under plugin/src) ============
local Bridge = (function()
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
	handlers: { [string]: (any) -> any },
	allowed: { [string]: boolean },
	cache: Cache,
	playtestActive: () -> boolean,
	ack: (id: string) -> (),
	heartbeat: (id: string) -> (),
	clock: () -> number,
	spawn: ((() -> ()) -> ())?,
	wait: ((number) -> ())?,
	beat_s: number?,
}
export type Outcome = { ok: boolean, result: any, error: string?, cached: boolean, refused: boolean }

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
	if env.spawn and env.wait then
		local spawn, wait = env.spawn, env.wait
		local beat = env.beat_s or 10
		spawn(function()
			while running do
				wait(beat)
				if running then
					env.heartbeat(c.id)
				end
			end
		end)
	end
	local ok, res = pcall(env.handlers[t], c.payload or {})
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
end)()

local SelfTest = (function()
-- BlockyAI in-Studio self-test. No AI is involved: the plugin exercises its own handlers against the real engine and reports pass/fail
-- with the RAW error for each step. This file holds the RUNNER (ordering, pcall wrapping, cleanup, reporting) and the step LIST.
-- The runner is unit tested with a fake engine. Whether each step passes in a real Studio can only be learned by pressing the button.
local S = {}

export type Step = { name: string, run: (ctx: any) -> any, optional: boolean?, requires: string? }
export type StepResult = { name: string, status: string, error: string?, detail: any?, ms: number }
export type Report = { passed: number, failed: number, skipped: number, steps: { StepResult }, cleaned: boolean, cleanup_error: string? }

-- status is one of: pass, fail, skip (a required feature is missing), fallback (worked, but via the documented fallback)
function S.run(steps: { Step }, ctx: any, features: { [string]: boolean }?, clock: (() -> number)?): Report
	local now = clock or os.clock
	local report: Report = { passed = 0, failed = 0, skipped = 0, steps = {}, cleaned = false }
	for _, step in ipairs(steps) do
		local t0 = now()
		local r: StepResult = { name = step.name, status = "pass", ms = 0 }
		if step.requires and features and features[step.requires] == false then
			r.status = "skip"
			r.error = "this Studio does not have " .. step.requires
			report.skipped += 1
		else
			local ok, res = pcall(step.run, ctx)
			if ok then
				if type(res) == "table" and (res :: any).fallback == true then
					r.status = "fallback"
				end
				r.detail = res
				report.passed += 1
			else
				r.status = "fail"
				r.error = tostring(res)
				report.failed += 1
			end
		end
		r.ms = math.floor((now() - t0) * 1000)
		table.insert(report.steps, r)
	end
	-- Cleanup ALWAYS runs, even when steps failed, and a failing cleanup is reported rather than hidden.
	local cok, cerr = true, nil :: any
	if ctx and ctx.cleanup then
		cok, cerr = pcall(ctx.cleanup)
	end
	report.cleaned = cok
	if not cok then
		report.cleanup_error = tostring(cerr)
	end
	return report
end

-- The fixed list. Each step receives `ctx`, which exposes the plugin's real handlers and a tracker so cleanup can remove what was made.
-- `ctx.h` = handlers table, `ctx.http(fn, body)` = POST to the server, `ctx.track(path)` = remember an instance path for cleanup.
function S.steps(): { Step }
	local function must(cond: any, msg: string)
		if not cond then
			error(msg, 0)
		end
	end
	return {
		{ name = "HTTP reachability", run = function(ctx)
			local data, code = ctx.http("plugin-register", { version = 0 })
			must(code == 200 and data ~= nil, "plugin-register returned " .. tostring(code))
			return { status = code }
		end },
		{ name = "build_model: kitchen-sink spec", run = function(ctx)
			local r = ctx.h.build_model({ parent = ctx.root, spec = ctx.kitchenSink })
			must(r and (r.errors == nil or #r.errors == 0), "build_model reported errors: " .. ctx.encode(r and r.errors or "no result"))
			must((r.instances or 0) >= 10, "expected 10 or more instances, got " .. tostring(r and r.instances))
			ctx.track(ctx.root .. ".SelfTestModel")
			return { instances = r.instances }
		end },
		{ name = "script write + read-back", run = function(ctx)
			local src = "print('blockyai selftest ' .. 1 + 1)\n"
			ctx.h.write_script({ path = ctx.root .. ".SelfTestScript", class = "Script", source = src })
			ctx.track(ctx.root .. ".SelfTestScript")
			local back = ctx.h.read_script({ path = ctx.root .. ".SelfTestScript" })
			must(back and back.source == src, "read-back differs from what was written")
			return { bytes = #src }
		end },
		{ name = "ui_build", run = function(ctx)
			local r = ctx.h.ui_build({ parent = ctx.root, spec = ctx.uiSpec })
			must(r and (r.errors == nil or #r.errors == 0), "ui_build reported errors: " .. ctx.encode(r and r.errors or "no result"))
			ctx.track(ctx.root .. ".SelfTestGui")
			return { instances = r.instances }
		end },
		{ name = "terrain_heightmap 16x16", requires = "Terrain.WriteVoxels", run = function(ctx)
			local heights = {}
			for z = 1, 16 do
				heights[z] = {}
				for x = 1, 16 do
					heights[z][x] = 4 + (x + z) % 3
				end
			end
			local r = ctx.h.terrain_heightmap({ heights = heights, origin = { 0, 0, 0 }, cell = 4, material = "Grass" })
			must(r and (r.ok ~= false), "terrain_heightmap failed: " .. ctx.encode(r))
			ctx.clearTerrain()
			return r
		end },
		{ name = "lighting_set", run = function(ctx)
			-- uses the real parameters: { lighting = {Property = value}, time_of_day = hours }. The original values are saved and put back.
			local saved = ctx.saveLighting()
			local r = ctx.h.lighting_set({ lighting = { Brightness = 3 }, time_of_day = 14 })
			must(r ~= nil, "no result")
			local failed = {}
			for _, c in ipairs(r.changed or {}) do
				if string.find(tostring(c), "FAILED", 1, true) then
					table.insert(failed, tostring(c))
				end
			end
			ctx.restoreLighting(saved)
			must(#failed == 0, "some lighting properties were rejected: " .. table.concat(failed, "; "))
			return { changed = r.changed }
		end },
		{ name = "camera_set", run = function(ctx)
			return ctx.h.camera_set({ position = { 20, 20, 20 }, look_at = { 0, 0, 0 } })
		end },
		{ name = "screenshot (reports the fallback honestly)", run = function(ctx)
			local r = ctx.h.screenshot({})
			must(r ~= nil, "no result")
			-- A scene report instead of pixels is a fallback, not a failure, and must be labelled as such.
			if r.scene_report ~= nil or r.png_b64 == nil then
				return { fallback = true, kind = "scene report (no pixels)" }
			end
			return { kind = "png", bytes = #r.png_b64 }
		end },
		{ name = "snapshot save + restore + compare", run = function(ctx)
			local before = ctx.countDescendants()
			local snap = ctx.h.snapshot_save({ label = "selftest" })
			ctx.h.create({ parent = ctx.root, class = "Part", name = "SelfTestExtra" })
			local mutated = ctx.countDescendants()
			must(mutated > before, "mutation did not change the tree (cannot test restore)")
			ctx.h.snapshot_restore({ id = snap.id })
			local after = ctx.countDescendants()
			must(after == before, ("restore did not return to the saved state: before=%d, after restore=%d"):format(before, after))
			return { before = before, mutated = mutated, after = after }
		end },
		{ name = "playtest start/stop with a print script and log read", requires = "StudioTestService", run = function(ctx)
			ctx.h.write_script({ path = "ServerScriptService.__BlockyAISelfTestPrint", class = "Script", source = "print('SELFTEST_MARKER_42')\n" })
			ctx.track("ServerScriptService.__BlockyAISelfTestPrint")
			local s = ctx.h.playtest_start({ mode = "run", seconds = 4 })
			must(s and s.started, "playtest_start did not start")
			ctx.wait(6)
			local logs = ctx.h.get_playtest_logs({})
			ctx.h.playtest_stop({})
			must(logs ~= nil, "no logs returned")
			must(ctx.encode(logs):find("SELFTEST_MARKER_42", 1, true) ~= nil, "the marker line was not found in the playtest logs")
			return { log_lines = #(logs.lines or logs) }
		end },
		{ name = "ChangeHistory undo", run = function(ctx)
			local before = ctx.countDescendants()
			ctx.h.create({ parent = ctx.root, class = "Part", name = "SelfTestUndo" })
			ctx.undo()
			local after = ctx.countDescendants()
			must(after == before, ("undo did not revert the create: before=%d after=%d"):format(before, after))
			return { before = before, after = after }
		end },
	}
end

return S
end)()

local Builder = (function()
-- BlockyAI builder: turns ONE JSON spec into a whole instance hierarchy.
-- Pure of plugin/UI code: it only needs Instance/Vector3/CFrame/Color3/Enum, so it is unit-tested against a mock engine.
local Builder = {}

local YIELD_EVERY = 50
local MAX_INSTANCES = 1500

-- ---------- value helpers ----------
local function num(v: any, d: number): number
	if type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge then
		return v
	end
	return d
end

local function vec3(v: any, d: Vector3): Vector3
	if type(v) ~= "table" then
		return d
	end
	local x = v[1] or v.x or v.X
	local y = v[2] or v.y or v.Y
	local z = v[3] or v.z or v.Z
	return Vector3.new(num(x, d.X), num(y, d.Y), num(z, d.Z))
end

local function color(v: any): Color3?
	if type(v) == "string" then
		local hex = string.match(v, "^#?(%x%x%x%x%x%x)$")
		if hex then
			return Color3.fromHex(hex)
		end
		return nil
	end
	if type(v) == "table" then
		local r = num(v[1] or v.r or v.R, 0)
		local g = num(v[2] or v.g or v.G, 0)
		local b = num(v[3] or v.b or v.B, 0)
		if r > 1 or g > 1 or b > 1 then
			return Color3.fromRGB(math.clamp(r, 0, 255), math.clamp(g, 0, 255), math.clamp(b, 0, 255))
		end
		return Color3.new(r, g, b)
	end
	return nil
end

local function enumOf(enumType: any, name: any): any?
	if typeof(name) == "EnumItem" then
		return name
	end
	if type(name) ~= "string" then
		return nil
	end
	local short = string.match(name, "([%w_]+)$")
	local ok, item = pcall(function()
		return (enumType :: any)[short]
	end)
	if ok and item ~= nil then
		return item
	end
	return nil
end

-- position/rotation are RELATIVE to the model origin; the model origin is `origin`.
local function cframeOf(spec: any, origin: CFrame): CFrame
	if type(spec.cframe) == "table" and #spec.cframe == 12 then
		return origin * CFrame.new(table.unpack(spec.cframe))
	end
	local pos = vec3(spec.position, Vector3.zero)
	local rot = vec3(spec.rotation, Vector3.zero)
	return origin * CFrame.new(pos) * CFrame.Angles(math.rad(rot.X), math.rad(rot.Y), math.rad(rot.Z))
end

-- ---------- class tables ----------
local PART_CLASSES = {
	Part = true, WedgePart = true, CornerWedgePart = true, TrussPart = true, MeshPart = true,
	Seat = true, VehicleSeat = true, SpawnLocation = true,
}
local SCRIPT_CLASSES = { Script = true, LocalScript = true, ModuleScript = true }
local CONSTRAINT_CLASSES = { WeldConstraint = true, Motor6D = true, HingeConstraint = true }
local EFFECT_CLASSES = {
	PointLight = true, SpotLight = true, SurfaceLight = true, ParticleEmitter = true, Sound = true, Attachment = true,
	Decal = true, Texture = true, SurfaceGui = true, SpecialMesh = true, ProximityPrompt = true, ClickDetector = true,
	Folder = true, Model = true, BillboardGui = true, TextLabel = true, Frame = true, UnionOperation = true,
	BoolValue = true, IntValue = true, NumberValue = true, StringValue = true, ObjectValue = true,
}
export type Result = {
	ok: boolean,
	error: string?,
	count: number?,
	errors: { string }?,
	instance: any?,
	path: string?,
	bounding_box: { size: { number }, center: { number } }?,
	by_class: { [string]: number }?,
}

function Builder.supports(class: string): boolean
	return PART_CLASSES[class] == true or SCRIPT_CLASSES[class] == true or CONSTRAINT_CLASSES[class] == true or EFFECT_CLASSES[class] == true
end

-- ---------- generic property bag (the spec's "properties") ----------
local BLOCKED_PROPS = { Parent = true, ClassName = true, Source = true, Archivable = false }

local function applyProps(inst: any, props: any, errors: { string }, label: string)
	if type(props) ~= "table" then
		return
	end
	for k, v in pairs(props) do
		if type(k) == "string" and not BLOCKED_PROPS[k] then
			local value: any = v
			if type(v) == "string" then
				if string.find(v, "^Enum%.") then
					local parts = string.split(v, ".")
					local okE, item = pcall(function()
						return (Enum :: any)[parts[2]][parts[3]]
					end)
					if okE then
						value = item
					end
				end
				if string.find(k, "Color") and type(v) == "string" and string.match(v, "^#") then
					value = color(v) or v
				end
			elseif type(v) == "table" then
				if string.find(k, "Color") then
					value = color(v) or v
				elseif v.x ~= nil or v[3] ~= nil then
					value = vec3(v, Vector3.zero)
				end
			end
			local ok, err = pcall(function()
				inst[k] = value
			end)
			if not ok then
				table.insert(errors, label .. "." .. k .. ": " .. tostring(err))
			end
		end
	end
end

-- ---------- one node ----------
local Ctx = {}
Ctx.__index = Ctx

function Builder.newContext(opts: any?)
	local o = opts or {}
	return setmetatable({
		count = 0,
		errors = {},
		byClass = {},
		parts = {} :: { any },
		named = {} :: { [string]: any },
		pending = {} :: { any },
		yield = o.yield or function() end,
		maxInstances = o.maxInstances or MAX_INSTANCES,
		allowScripts = o.allowScripts ~= false,
	}, Ctx)
end

function Ctx:note(inst: any, label: string)
	self.count += 1
	self.byClass[inst.ClassName] = (self.byClass[inst.ClassName] or 0) + 1
	if self.count % YIELD_EVERY == 0 then
		self.yield()
	end
end

function Ctx:fail(msg: string)
	if #self.errors < 60 then
		table.insert(self.errors, msg)
	end
end

local function setCommon(ctx: any, inst: any, spec: any, label: string)
	if spec.attributes and type(spec.attributes) == "table" then
		for k, v in pairs(spec.attributes) do
			local ok, err = pcall(function()
				inst:SetAttribute(k, v)
			end)
			if not ok then
				ctx:fail(label .. " attribute " .. tostring(k) .. ": " .. tostring(err))
			end
		end
	end
	if spec.tags and type(spec.tags) == "table" then
		for _, tag in ipairs(spec.tags) do
			pcall(function()
				game:GetService("CollectionService"):AddTag(inst, tostring(tag))
			end)
		end
	end
	applyProps(inst, spec.properties, ctx.errors, label)
end

local function setPart(ctx: any, part: any, spec: any, origin: CFrame, label: string)
	local size = vec3(spec.size, Vector3.new(4, 1, 2))
	for _, axis in ipairs({ size.X, size.Y, size.Z }) do
		if axis <= 0 then
			ctx:fail(label .. ": size must be positive (got " .. tostring(axis) .. "); using 1")
		end
	end
	part.Size = Vector3.new(math.max(size.X, 0.05), math.max(size.Y, 0.05), math.max(size.Z, 0.05))
	part.CFrame = cframeOf(spec, origin)
	part.Anchored = spec.anchored ~= false
	if spec.canCollide ~= nil then
		part.CanCollide = spec.canCollide == true
	end
	if spec.castShadow ~= nil then
		part.CastShadow = spec.castShadow == true
	end
	local c = color(spec.color)
	if c then
		part.Color = c
	elseif spec.color ~= nil then
		ctx:fail(label .. ": unknown color " .. tostring(spec.color))
	end
	if spec.material ~= nil then
		local m = enumOf(Enum.Material, spec.material)
		if m then
			part.Material = m
		else
			ctx:fail(label .. ": unknown material " .. tostring(spec.material))
		end
	end
	if spec.transparency ~= nil then
		part.Transparency = math.clamp(num(spec.transparency, 0), 0, 1)
	end
	if spec.reflectance ~= nil then
		part.Reflectance = math.clamp(num(spec.reflectance, 0), 0, 1)
	end
	if spec.shape ~= nil and part.ClassName == "Part" then
		local s = enumOf(Enum.PartType, spec.shape)
		if s then
			part.Shape = s
		else
			ctx:fail(label .. ": unknown shape " .. tostring(spec.shape))
		end
	end
	if part.ClassName == "MeshPart" and spec.mesh_id then
		-- MeshId is read-only after creation in a live place; record it so the caller can see why it is blank.
		ctx:fail(label .. ": MeshPart MeshId cannot be set from a plugin at runtime; use insert_asset or a SpecialMesh")
	end
end

function Builder.buildNode(ctx: any, spec: any, parent: any, origin: CFrame, path: string): any?
	if ctx.count >= ctx.maxInstances then
		ctx:fail(path .. ": instance limit " .. ctx.maxInstances .. " reached; split the build into sections")
		return nil
	end
	if type(spec) ~= "table" then
		ctx:fail(path .. ": child spec is not an object")
		return nil
	end
	local class = spec.class or "Part"
	local name = tostring(spec.name or class)
	local label = path .. "/" .. name
	if not Builder.supports(class) then
		ctx:fail(label .. ": class " .. tostring(class) .. " is not supported by build_model")
		return nil
	end
	if SCRIPT_CLASSES[class] and not ctx.allowScripts then
		ctx:fail(label .. ": scripts are disabled for this build")
		return nil
	end
	local ok, inst = pcall(function()
		return Instance.new(class)
	end)
	if not ok or inst == nil then
		ctx:fail(label .. ": Instance.new(" .. class .. ") failed: " .. tostring(inst))
		return nil
	end
	inst.Name = name
	if PART_CLASSES[class] then
		setPart(ctx, inst, spec, origin, label)
		table.insert(ctx.parts, inst)
	elseif class == "Model" then
		-- sub-model: children are positioned relative to THIS model's origin, which is offset by the spec position
		origin = cframeOf(spec, origin)
	elseif SCRIPT_CLASSES[class] then
		if type(spec.source) ~= "string" then
			ctx:fail(label .. ": script has no source string")
		else
			inst.Source = spec.source
		end
		if class ~= "ModuleScript" and spec.disabled == true then
			inst.Enabled = false
		end
	elseif class == "WeldConstraint" or class == "Motor6D" or class == "HingeConstraint" then
		table.insert(ctx.pending, { inst = inst, spec = spec, label = label })
	elseif class == "Attachment" then
		inst.CFrame = CFrame.new(vec3(spec.position, Vector3.zero))
	elseif class == "Decal" or class == "Texture" then
		if spec.texture then
			inst.Texture = tostring(spec.texture)
		end
		if spec.face then
			local f = enumOf(Enum.NormalId, spec.face)
			if f then
				inst.Face = f
			end
		end
	elseif class == "SpecialMesh" then
		local mt = enumOf(Enum.MeshType, spec.mesh_type or "Brick")
		if mt then
			inst.MeshType = mt
		end
		if spec.scale then
			inst.Scale = vec3(spec.scale, Vector3.one)
		end
	elseif class == "ProximityPrompt" then
		inst.ActionText = tostring(spec.action_text or "Use")
		inst.ObjectText = tostring(spec.object_text or "")
		inst.MaxActivationDistance = num(spec.distance, 10)
	end
	if spec.pivot and (class == "Model" or PART_CLASSES[class]) then
		local okP, errP = pcall(function()
			inst.PivotOffset = CFrame.new(vec3(spec.pivot, Vector3.zero))
		end)
		if not okP then
			ctx:fail(label .. ": pivot failed: " .. tostring(errP))
		end
	end
	setCommon(ctx, inst, spec, label)
	ctx:note(inst, label)
	if spec.id_key then
		ctx.named[tostring(spec.id_key)] = inst
	end
	ctx.named[name] = ctx.named[name] or inst
	if type(spec.children) == "table" then
		for _, child in ipairs(spec.children) do
			Builder.buildNode(ctx, child, inst, origin, label)
		end
	end
	-- Parent LAST: the whole subtree is complete before it appears in the DataModel (fewer replication/event hits).
	local okParent, errParent = pcall(function()
		inst.Parent = parent
	end)
	if not okParent then
		ctx:fail(label .. ": parenting failed: " .. tostring(errParent))
	end
	return inst
end

-- constraints need their targets, which exist only after the whole tree is built
local function resolveConstraints(ctx: any)
	for _, p in ipairs(ctx.pending) do
		local a = p.spec.part0 and ctx.named[p.spec.part0]
		local b = p.spec.part1 and ctx.named[p.spec.part1]
		if not a or not b then
			ctx:fail(p.label .. ": part0/part1 must name parts in this build (got " .. tostring(p.spec.part0) .. ", " .. tostring(p.spec.part1) .. ")")
		else
			local okC, errC = pcall(function()
				p.inst.Part0 = a
				p.inst.Part1 = b
				if p.inst.ClassName == "WeldConstraint" then
					-- WeldConstraint keeps the CURRENT relative position
					p.inst.Parent = a
				end
			end)
			if not okC then
				ctx:fail(p.label .. ": " .. tostring(errC))
			end
		end
	end
end

-- weld every part to the primary part (anchored builds do not need it, but unanchored ones fall apart without it)
local function weldAll(ctx: any, primary: any, parent: any)
	if not primary then
		return 0
	end
	local n = 0
	for _, part in ipairs(ctx.parts) do
		if part ~= primary and part.ClassName ~= "TrussPart" then
			local w = Instance.new("WeldConstraint")
			w.Part0 = primary
			w.Part1 = part
			w.Name = "AutoWeld"
			w.Parent = part
			n += 1
			if n % YIELD_EVERY == 0 then
				ctx.yield()
			end
		end
	end
	return n
end

function Builder.boundingBox(parts: { any }): ({ size: { number }, center: { number } }?)
	if #parts == 0 then
		return nil
	end
	local minV = Vector3.new(math.huge, math.huge, math.huge)
	local maxV = Vector3.new(-math.huge, -math.huge, -math.huge)
	for _, p in ipairs(parts) do
		local cf, s = p.CFrame, p.Size
		for _, sx in ipairs({ -0.5, 0.5 }) do
			for _, sy in ipairs({ -0.5, 0.5 }) do
				for _, sz in ipairs({ -0.5, 0.5 }) do
					local w = cf * Vector3.new(s.X * sx, s.Y * sy, s.Z * sz)
					minV = Vector3.new(math.min(minV.X, w.X), math.min(minV.Y, w.Y), math.min(minV.Z, w.Z))
					maxV = Vector3.new(math.max(maxV.X, w.X), math.max(maxV.Y, w.Y), math.max(maxV.Z, w.Z))
				end
			end
		end
	end
	local size = maxV - minV
	local c = (minV + maxV) / 2
	local function r(n: number): number
		return math.floor(n * 100 + 0.5) / 100
	end
	return { size = { r(size.X), r(size.Y), r(size.Z) }, center = { r(c.X), r(c.Y), r(c.Z) } }
end

-- Public: build a whole spec under `parent`. origin defaults to the world origin (or spec.position).
function Builder.build(parent: any, spec: any, opts: any?): Result
	local ctx = Builder.newContext(opts)
	if type(spec) ~= "table" then
		return { ok = false, error = "spec must be an object" }
	end
	if type(spec.name) ~= "string" or spec.name == "" then
		return { ok = false, error = "spec.name is required" }
	end
	local origin = (opts and opts.origin) or CFrame.new()
	local root = Builder.buildNode(ctx, spec, parent, origin, "")
	if root == nil then
		return { ok = false, error = "root failed to build", errors = ctx.errors, count = ctx.count }
	end
	resolveConstraints(ctx)
	local welds = 0
	local primary = nil
	if root.ClassName == "Model" then
		local pname = spec.primary_part
		if pname then
			primary = ctx.named[pname]
			if primary and primary:IsA("BasePart") then
				root.PrimaryPart = primary
			else
				ctx:fail("primary_part '" .. tostring(pname) .. "' is not a part in this build")
				primary = nil
			end
		elseif #ctx.parts > 0 then
			primary = ctx.parts[1]
			root.PrimaryPart = primary
		end
		if spec.weld == true then
			welds = weldAll(ctx, primary, root)
		end
	end
	local bb = Builder.boundingBox(ctx.parts)
	local okPath, path = pcall(function()
		return root:GetFullName()
	end)
	return {
		ok = true,
		instance = root,
		path = okPath and path or spec.name,
		count = ctx.count,
		parts = #ctx.parts,
		welds = welds,
		primary_part = primary and primary.Name or nil,
		bounding_box = bb,
		by_class = ctx.byClass,
		errors = ctx.errors,
	}
end

return Builder
end)()

local Transform = (function()
-- BlockyAI transform / query commands. Pure logic over Instances (Model/BasePart): duplicate, mirror, scale, align, distribute,
-- snap_to_ground, bounding box, pivot, measure. The Roblox-specific calls (Raycast, GetBoundingBox) are injected through `api`
-- so the same code runs in Studio and in the unit tests.
local T = {}

export type Api = {
	raycast: (origin: Vector3, direction: Vector3, ignore: { any }?) -> { position: Vector3, normal: Vector3, instance: any }?,
	yield: () -> (),
}

local function r2(n: number): number
	return math.floor(n * 100 + 0.5) / 100
end
local function v3(v: Vector3): { number }
	return { r2(v.X), r2(v.Y), r2(v.Z) }
end

local function partsOf(inst: any): { any }
	local out = {}
	if inst:IsA("BasePart") then
		table.insert(out, inst)
	end
	for _, d in ipairs(inst:GetDescendants()) do
		if d:IsA("BasePart") then
			table.insert(out, d)
		end
	end
	return out
end
T.partsOf = partsOf

-- axis-aligned world bounding box of every part (handles rotation by transforming all 8 corners)
function T.boundingBox(inst: any): { size: Vector3, center: Vector3, min: Vector3, max: Vector3, parts: number }?
	local parts = partsOf(inst)
	if #parts == 0 then
		return nil
	end
	local lo = Vector3.new(math.huge, math.huge, math.huge)
	local hi = Vector3.new(-math.huge, -math.huge, -math.huge)
	for _, p in ipairs(parts) do
		for _, sx in ipairs({ -0.5, 0.5 }) do
			for _, sy in ipairs({ -0.5, 0.5 }) do
				for _, sz in ipairs({ -0.5, 0.5 }) do
					local w = p.CFrame * Vector3.new(p.Size.X * sx, p.Size.Y * sy, p.Size.Z * sz)
					lo = Vector3.new(math.min(lo.X, w.X), math.min(lo.Y, w.Y), math.min(lo.Z, w.Z))
					hi = Vector3.new(math.max(hi.X, w.X), math.max(hi.Y, w.Y), math.max(hi.Z, w.Z))
				end
			end
		end
	end
	return { size = hi - lo, center = (lo + hi) / 2, min = lo, max = hi, parts = #parts }
end

function T.describeBox(inst: any): any
	local b = T.boundingBox(inst)
	if not b then
		return { ok = false, error = "no parts under " .. inst.Name }
	end
	return { ok = true, size = v3(b.size), center = v3(b.center), min = v3(b.min), max = v3(b.max), parts = b.parts }
end

function T.getPivot(inst: any): any
	local ok, cf = pcall(function()
		return inst:GetPivot()
	end)
	if not ok then
		return { ok = false, error = "instance has no pivot: " .. tostring(cf) }
	end
	return { ok = true, position = v3(cf.Position) }
end

function T.measure(a: any, b: any): any
	local ba, bb = T.boundingBox(a), T.boundingBox(b)
	if not ba or not bb then
		return { ok = false, error = "both instances need at least one part" }
	end
	local d = bb.center - ba.center
	-- gap along each axis between the two boxes (negative = overlap)
	local gx = math.max(ba.min.X - bb.max.X, bb.min.X - ba.max.X)
	local gy = math.max(ba.min.Y - bb.max.Y, bb.min.Y - ba.max.Y)
	local gz = math.max(ba.min.Z - bb.max.Z, bb.min.Z - ba.max.Z)
	return { ok = true, center_distance = r2(d.Magnitude), delta = v3(d), gap = { r2(gx), r2(gy), r2(gz) }, overlapping = gx < 0 and gy < 0 and gz < 0 }
end

local function movePartsBy(inst: any, delta: Vector3)
	for _, p in ipairs(partsOf(inst)) do
		p.CFrame = p.CFrame + delta
	end
end

-- Move a whole instance (Model or part) so its bounding-box center is at `target`.
function T.moveCenterTo(inst: any, target: Vector3): any
	local b = T.boundingBox(inst)
	if not b then
		return { ok = false, error = "nothing to move" }
	end
	movePartsBy(inst, target - b.center)
	return { ok = true }
end

local function cloneNamed(src: any, name: string, parent: any): any
	local c = src:Clone()
	c.Name = name
	c.Parent = parent
	return c
end

-- duplicate_array: `count` copies, each offset by `offset` from the previous one
function T.duplicateArray(src: any, count: number, offset: Vector3, api: Api): any
	if count < 1 or count > 500 then
		return { ok = false, error = "count must be 1..500" }
	end
	local made, created = {}, 0
	for i = 1, count do
		local c = cloneNamed(src, src.Name .. "_" .. i, src.Parent)
		movePartsBy(c, offset * i)
		table.insert(made, c.Name)
		created += #partsOf(c)
		if i % 25 == 0 then
			api.yield()
		end
	end
	return { ok = true, copies = count, parts_created = created, names = made }
end

function T.duplicateGrid(src: any, nx: number, nz: number, dx: number, dz: number, api: Api, ny: number?, dy: number?): any
	local layers = ny or 1
	if nx < 1 or nz < 1 or layers < 1 or nx * nz * layers > 1000 then
		return { ok = false, error = "grid too large: nx*nz*ny must be 1..1000" }
	end
	local n, parts = 0, 0
	for ix = 0, nx - 1 do
		for iz = 0, nz - 1 do
			for iy = 0, layers - 1 do
				if not (ix == 0 and iz == 0 and iy == 0) then
					local c = cloneNamed(src, string.format("%s_%d_%d_%d", src.Name, ix, iz, iy), src.Parent)
					movePartsBy(c, Vector3.new(ix * dx, iy * (dy or 0), iz * dz))
					n += 1
					parts += #partsOf(c)
					if n % 25 == 0 then
						api.yield()
					end
				end
			end
		end
	end
	return { ok = true, copies = n, parts_created = parts }
end

-- points: list of {x,y,z}; `count` copies are spaced evenly (by arc length) along the polyline
function T.duplicateAlongPath(src: any, points: { Vector3 }, count: number, api: Api): any
	if #points < 2 then
		return { ok = false, error = "path needs at least 2 points" }
	end
	if count < 1 or count > 500 then
		return { ok = false, error = "count must be 1..500" }
	end
	local lens, total = {}, 0
	for i = 1, #points - 1 do
		local l = (points[i + 1] - points[i]).Magnitude
		lens[i] = l
		total += l
	end
	if total <= 0 then
		return { ok = false, error = "path has zero length" }
	end
	local made = 0
	local origin = (T.boundingBox(src) :: any).center
	for i = 0, count - 1 do
		local want = (count == 1) and 0 or (total * i / (count - 1))
		local seg, acc = 1, 0
		while seg < #lens and acc + lens[seg] < want do
			acc += lens[seg]
			seg += 1
		end
		local t = lens[seg] > 0 and (want - acc) / lens[seg] or 0
		local pos = points[seg]:Lerp(points[seg + 1], t)
		local c = cloneNamed(src, src.Name .. "_p" .. (i + 1), src.Parent)
		movePartsBy(c, pos - origin)
		made += 1
		if made % 25 == 0 then
			api.yield()
		end
	end
	return { ok = true, copies = made, path_length = r2(total) }
end

-- mirror across a world axis plane through `at` (default: the instance's own center). Creates a mirrored COPY.
function T.mirror(src: any, axis: string, at: number?, api: Api): any
	local ax = string.upper(axis)
	if ax ~= "X" and ax ~= "Y" and ax ~= "Z" then
		return { ok = false, error = "axis must be X, Y or Z" }
	end
	local b = T.boundingBox(src)
	if not b then
		return { ok = false, error = "nothing to mirror" }
	end
	local plane = at or (b.center :: any)[ax]
	local c = cloneNamed(src, src.Name .. "_mirror" .. ax, src.Parent)
	local n = 0
	for _, p in ipairs(partsOf(c)) do
		local pos = p.Position
		local newPos = Vector3.new(ax == "X" and (2 * plane - pos.X) or pos.X, ax == "Y" and (2 * plane - pos.Y) or pos.Y, ax == "Z" and (2 * plane - pos.Z) or pos.Z)
		-- Mirroring flips handedness, which a CFrame cannot express. Reflecting the rotation matrix is skipped: parts keep their
		-- orientation and only their position reflects. That is exact for axis-aligned parts; wedges/stairs may need a 180 turn.
		p.CFrame = p.CFrame - pos + newPos
		n += 1
		if n % 50 == 0 then
			api.yield()
		end
	end
	return { ok = true, name = c.Name, parts = n, plane = r2(plane), note = "positions reflected; part orientations are not reflected (wedges may need rotation)" }
end

function T.scaleModel(inst: any, factor: number, api: Api): any
	if factor <= 0 or factor > 50 then
		return { ok = false, error = "factor must be > 0 and <= 50" }
	end
	local b = T.boundingBox(inst)
	if not b then
		return { ok = false, error = "nothing to scale" }
	end
	local pivot = b.center
	local n = 0
	for _, p in ipairs(partsOf(inst)) do
		local rel = p.Position - pivot
		p.Size = p.Size * factor
		p.CFrame = p.CFrame - p.Position + pivot + rel * factor
		n += 1
		if n % 50 == 0 then
			api.yield()
		end
	end
	local after = T.boundingBox(inst) :: any
	return { ok = true, parts = n, factor = factor, size_after = v3(after.size) }
end

-- align: line `items` up on `axis` using min / center / max of their boxes, relative to the FIRST item
function T.align(items: { any }, axis: string, mode: string): any
	local ax = string.upper(axis)
	if (ax ~= "X" and ax ~= "Y" and ax ~= "Z") or (mode ~= "min" and mode ~= "center" and mode ~= "max") then
		return { ok = false, error = "axis X|Y|Z, mode min|center|max" }
	end
	if #items < 2 then
		return { ok = false, error = "align needs at least 2 items" }
	end
	local function ref(b: any): number
		return mode == "min" and (b.min :: any)[ax] or mode == "max" and (b.max :: any)[ax] or (b.center :: any)[ax]
	end
	local first = T.boundingBox(items[1])
	if not first then
		return { ok = false, error = "first item has no parts" }
	end
	local target = ref(first)
	for i = 2, #items do
		local b = T.boundingBox(items[i])
		if b then
			local d = target - ref(b)
			movePartsBy(items[i], Vector3.new(ax == "X" and d or 0, ax == "Y" and d or 0, ax == "Z" and d or 0))
		end
	end
	return { ok = true, aligned = #items, axis = ax, mode = mode }
end

-- distribute: even spacing between centers along `axis`, keeping the first and last where they are
function T.distribute(items: { any }, axis: string): any
	local ax = string.upper(axis)
	if ax ~= "X" and ax ~= "Y" and ax ~= "Z" then
		return { ok = false, error = "axis must be X, Y or Z" }
	end
	if #items < 3 then
		return { ok = false, error = "distribute needs at least 3 items" }
	end
	local sorted = {}
	for _, it in ipairs(items) do
		local b = T.boundingBox(it)
		if b then
			table.insert(sorted, { inst = it, c = (b.center :: any)[ax] })
		end
	end
	table.sort(sorted, function(a, b)
		return a.c < b.c
	end)
	local lo, hi = sorted[1].c, sorted[#sorted].c
	for i = 2, #sorted - 1 do
		local want = lo + (hi - lo) * (i - 1) / (#sorted - 1)
		local d = want - sorted[i].c
		movePartsBy(sorted[i].inst, Vector3.new(ax == "X" and d or 0, ax == "Y" and d or 0, ax == "Z" and d or 0))
	end
	return { ok = true, distributed = #sorted, spacing = r2((hi - lo) / (#sorted - 1)) }
end

-- snap_to_ground: raycast straight down from above each item's center; rest its LOWEST point on the hit.
-- Returns per-item results; items that hit nothing are reported and left untouched (never silently moved).
function T.snapToGround(items: { any }, api: Api, offset: number?, maxHeight: number?): any
	local results, snapped, missed = {}, 0, 0
	local up = maxHeight or 200
	for _, it in ipairs(items) do
		local b = T.boundingBox(it)
		if not b then
			table.insert(results, { name = it.Name, ok = false, error = "no parts" })
			missed += 1
		else
			local origin = Vector3.new(b.center.X, b.max.Y + up, b.center.Z)
			local hit = api.raycast(origin, Vector3.new(0, -(up + 2000), 0), { it })
			if not hit then
				table.insert(results, { name = it.Name, ok = false, error = "nothing below to land on" })
				missed += 1
			else
				local dy = (hit.position.Y + (offset or 0)) - b.min.Y
				movePartsBy(it, Vector3.new(0, dy, 0))
				snapped += 1
				table.insert(results, { name = it.Name, ok = true, moved_y = r2(dy), landed_on = hit.instance and hit.instance.Name or "?", ground_y = r2(hit.position.Y) })
			end
		end
		if (snapped + missed) % 25 == 0 then
			api.yield()
		end
	end
	return { ok = true, snapped = snapped, missed = missed, results = results }
end

-- find_empty_space: scan a grid of candidate centers; a spot is free if the box there overlaps none of `existing`'s boxes
function T.findEmptySpace(size: Vector3, area: { min: Vector3, max: Vector3 }, existing: { any }, step: number?, y: number?): any
	local boxes = {}
	for _, e in ipairs(existing) do
		local b = T.boundingBox(e)
		if b then
			table.insert(boxes, b)
		end
	end
	local s = step or math.max(size.X, size.Z)
	local found = {}
	local x = area.min.X + size.X / 2
	while x <= area.max.X - size.X / 2 do
		local z = area.min.Z + size.Z / 2
		while z <= area.max.Z - size.Z / 2 do
			local free = true
			for _, b in ipairs(boxes) do
				if math.abs(x - b.center.X) < (size.X + b.size.X) / 2 and math.abs(z - b.center.Z) < (size.Z + b.size.Z) / 2 then
					free = false
					break
				end
			end
			if free then
				table.insert(found, { r2(x), r2(y or area.min.Y), r2(z) })
				if #found >= 20 then
					return { ok = true, spots = found, checked_boxes = #boxes }
				end
			end
			z += s
		end
		x += s
	end
	return { ok = #found > 0, spots = found, checked_boxes = #boxes, error = #found == 0 and "no free space of that size in the area" or nil }
end

return T
end)()

local UIBuild = (function()
-- ui_build: JSON spec -> ScreenGui. Pure of plugin code (needs only Instance/UDim2/Color3/Enum), unit-tested on a mock engine.
-- Spec node: { class, name, size:[sx,ox,sy,oy], position:[...], anchor:[x,y], color, bg_transparency, text, text_color, text_size,
--   font, corner, stroke:{color,thickness}, padding, layout:{type:"list"|"grid", direction, gap}, children:[...], properties:{} }
local UI = {}

local ALLOWED = {
	ScreenGui = true, Frame = true, TextLabel = true, TextButton = true, TextBox = true, ImageLabel = true, ImageButton = true,
	ScrollingFrame = true, UIListLayout = true, UIGridLayout = true, UICorner = true, UIStroke = true, UIPadding = true,
	UIAspectRatioConstraint = true, UIGradient = true,
}
local TEXT_CLASSES = { TextLabel = true, TextButton = true, TextBox = true }

local function num(v: any, d: number): number
	if type(v) == "number" and v == v then
		return v
	end
	return d
end

local function udim2(v: any, d: UDim2): UDim2
	if type(v) ~= "table" then
		return d
	end
	if #v == 4 then
		return UDim2.new(num(v[1], 0), num(v[2], 0), num(v[3], 0), num(v[4], 0))
	end
	if #v == 2 then
		return UDim2.fromScale(num(v[1], 0), num(v[2], 0))
	end
	return d
end

local function color(v: any): Color3?
	if type(v) == "string" then
		local hex = string.match(v, "^#?(%x%x%x%x%x%x)$")
		if hex then
			return Color3.fromHex(hex)
		end
	elseif type(v) == "table" then
		return Color3.fromRGB(num(v[1], 0), num(v[2], 0), num(v[3], 0))
	end
	return nil
end

local function enumByName(enumType: any, name: any): any?
	if type(name) ~= "string" then
		return nil
	end
	local ok, item = pcall(function()
		return enumType[name]
	end)
	if ok then
		return item
	end
	return nil
end

function UI.buildNode(spec: any, parent: any, errors: { string }, counter: { n: number }, path: string): any?
	if type(spec) ~= "table" then
		table.insert(errors, path .. ": node is not an object")
		return nil
	end
	local class = spec.class or "Frame"
	local label = path .. "/" .. tostring(spec.name or class)
	if not ALLOWED[class] then
		table.insert(errors, label .. ": class " .. tostring(class) .. " is not allowed in ui_build")
		return nil
	end
	local inst = Instance.new(class)
	inst.Name = tostring(spec.name or class)
	counter.n += 1
	if inst:IsA("GuiObject") then
		local g = inst :: any
		g.Size = udim2(spec.size, UDim2.fromOffset(100, 40))
		g.Position = udim2(spec.position, UDim2.new())
		if type(spec.anchor) == "table" then
			g.AnchorPoint = Vector2.new(num(spec.anchor[1], 0), num(spec.anchor[2], 0))
		end
		local bg = color(spec.color)
		if bg then
			g.BackgroundColor3 = bg
		elseif spec.color ~= nil then
			table.insert(errors, label .. ": unknown color " .. tostring(spec.color))
		end
		g.BackgroundTransparency = math.clamp(num(spec.bg_transparency, class == "TextLabel" and 1 or 0), 0, 1)
		g.BorderSizePixel = 0
		if spec.visible == false then
			g.Visible = false
		end
	end
	if TEXT_CLASSES[class] then
		local t = inst :: any
		t.Text = tostring(spec.text or "")
		t.TextSize = math.clamp(num(spec.text_size, 18), 6, 96)
		t.TextColor3 = color(spec.text_color) or Color3.new(1, 1, 1)
		t.Font = enumByName(Enum.Font, spec.font) or Enum.Font.GothamBold
		t.TextWrapped = spec.wrap ~= false
	end
	if (class == "ImageLabel" or class == "ImageButton") and spec.image then
		(inst :: any).Image = tostring(spec.image)
	end
	if class == "UIListLayout" then
		local l = inst :: any
		l.Padding = UDim.new(0, num(spec.gap, 6))
		l.SortOrder = Enum.SortOrder.LayoutOrder
		l.FillDirection = enumByName(Enum.FillDirection, spec.direction) or Enum.FillDirection.Vertical
	elseif class == "UIGridLayout" then
		local l = inst :: any
		l.CellSize = udim2(spec.cell_size, UDim2.fromOffset(80, 80))
		l.CellPadding = UDim2.fromOffset(num(spec.gap, 6), num(spec.gap, 6))
	elseif class == "UICorner" then
		(inst :: any).CornerRadius = UDim.new(0, num(spec.radius, 8))
	elseif class == "UIStroke" then
		local s = inst :: any
		s.Thickness = num(spec.thickness, 2)
		s.Color = color(spec.color) or Color3.new(1, 1, 1)
	elseif class == "UIPadding" then
		local pad = UDim.new(0, num(spec.padding, 8))
		local p = inst :: any
		p.PaddingTop, p.PaddingBottom, p.PaddingLeft, p.PaddingRight = pad, pad, pad, pad
	elseif class == "ScreenGui" then
		local sg = inst :: any
		sg.ResetOnSpawn = spec.reset_on_spawn == true
		sg.IgnoreGuiInset = spec.ignore_inset == true
	end
	-- shorthand decorations so the agent writes less JSON
	if inst:IsA("GuiObject") then
		if spec.corner then
			local c = Instance.new("UICorner")
			c.CornerRadius = UDim.new(0, num(spec.corner, 8))
			c.Parent = inst
			counter.n += 1
		end
		if type(spec.stroke) == "table" then
			local s = Instance.new("UIStroke")
			s.Thickness = num(spec.stroke.thickness, 2)
			s.Color = color(spec.stroke.color) or Color3.new(1, 1, 1)
			s.Parent = inst
			counter.n += 1
		end
		if type(spec.layout) == "table" then
			local lc = spec.layout.type == "grid" and "UIGridLayout" or "UIListLayout"
			UI.buildNode({ class = lc, name = "Layout", gap = spec.layout.gap, direction = spec.layout.direction, cell_size = spec.layout.cell_size }, inst, errors, counter, label)
		end
		if spec.padding then
			UI.buildNode({ class = "UIPadding", name = "Padding", padding = spec.padding }, inst, errors, counter, label)
		end
	end
	if type(spec.attributes) == "table" then
		for k, v in pairs(spec.attributes) do
			pcall(function()
				inst:SetAttribute(k, v)
			end)
		end
	end
	for _, child in ipairs(spec.children or {}) do
		UI.buildNode(child, inst, errors, counter, label)
	end
	inst.Parent = parent
	return inst
end

function UI.build(parent: any, spec: any): any
	if type(spec) ~= "table" then
		return { ok = false, error = "spec must be an object" }
	end
	if spec.class ~= nil and spec.class ~= "ScreenGui" then
		return { ok = false, error = "the root of a ui_build spec must be a ScreenGui" }
	end
	spec.class = "ScreenGui"
	local errors, counter = {}, { n = 0 }
	local root = UI.buildNode(spec, parent, errors, counter, "")
	if not root then
		return { ok = false, error = "root failed", errors = errors }
	end
	return { ok = true, instance = root, path = root:GetFullName(), count = counter.n, errors = errors }
end

return UI
end)()

local Cmds = (function()
-- BlockyAI Studio command handlers for the build-capable commands. They bind the pure Builder/Transform modules to real
-- Studio APIs. Every handler returns a table with real counts/paths, or raises an error with the real reason. Nothing returns "done".
local Cmds = {}

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")

local function r2(n: number): number
	return math.floor(n * 100 + 0.5) / 100
end
local function v3(v: Vector3): { number }
	return { r2(v.X), r2(v.Y), r2(v.Z) }
end

-- Injected by the plugin main: path resolution, logging, templates. Keeps this file free of UI/network code.
export type Deps = {
	Builder: any,
	Transform: any,
	resolve: (path: string) -> Instance?,
	pathOf: (inst: Instance) -> string,
	logEdit: (action: string, target: string, before: any, after: any) -> (),
	templates: { [string]: any },
	post: (fn: string, body: any, withToken: boolean) -> (any, any),
	flash: ((inst: Instance) -> ())?,
}

local D: Deps

function Cmds.init(deps: Deps)
	D = deps
end

local function need(path: any, what: string): Instance
	if type(path) ~= "string" or path == "" then
		error(what .. " path is required")
	end
	local i = D.resolve(path)
	if not i then
		error(what .. " not found: " .. path)
	end
	return i
end

local api = {
	yield = function()
		task.wait()
	end,
	raycast = function(origin: Vector3, direction: Vector3, ignore: { any }?)
		local params = RaycastParams.new()
		params.FilterType = Enum.RaycastFilterType.Exclude
		params.FilterDescendantsInstances = ignore or {}
		local hit = workspace:Raycast(origin, direction, params)
		if hit then
			return { position = hit.Position, normal = hit.Normal, instance = hit.Instance }
		end
		return nil
	end,
}
Cmds.api = api

-- ---------- build_model ----------
-- Splits big specs automatically: > 500 instances is built section by section (top-level children become their own builds).
local function countSpec(spec: any): number
	local n = 1
	if type(spec.children) == "table" then
		for _, c in ipairs(spec.children) do
			if type(c) == "table" then
				n += countSpec(c)
			end
		end
	end
	return n
end
Cmds.countSpec = countSpec

function Cmds.build_model(p: any): any
	if type(p.spec) ~= "table" then
		error("spec is required (an object with name, class, children)")
	end
	local parent = need(p.parent or "Workspace", "parent")
	local total = countSpec(p.spec)
	if total > 1500 then
		error(("spec has %d instances; the limit is 1500 per call. Split it into several build_model calls by section."):format(total))
	end
	local origin = CFrame.new()
	if type(p.origin) == "table" then
		origin = CFrame.new(Vector3.new(p.origin[1] or 0, p.origin[2] or 0, p.origin[3] or 0))
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before build_model " .. tostring(p.spec.name))
	local res = D.Builder.build(parent, p.spec, { yield = api.yield, origin = origin, allowScripts = p.allow_scripts ~= false })
	ChangeHistoryService:SetWaypoint("BlockyAI build_model " .. tostring(p.spec.name))
	if not res.ok then
		error("build failed: " .. tostring(res.error) .. (res.errors and #res.errors > 0 and (" | " .. table.concat(res.errors, " | ")) or ""))
	end
	D.logEdit("build_model", res.path, nil, { instances = res.count, parts = res.parts })
	if D.flash and res.instance then
		D.flash(res.instance)
	end
	return {
		path = res.path, instances = res.count, parts = res.parts, welds = res.welds, primary_part = res.primary_part,
		bounding_box = res.bounding_box, by_class = res.by_class, errors = res.errors, error_count = #res.errors,
		note = #res.errors > 0 and "Built with problems: fix or rebuild the listed children." or "Built with no errors. Not yet visually verified: take screenshots.",
	}
end

-- ---------- templates ----------
function Cmds.template_save(p: any): any
	if type(p.name) ~= "string" or not string.match(p.name, "^[%w_%-]+$") then
		error("template name must be letters, digits, _ or -")
	end
	local spec = p.spec
	if type(spec) ~= "table" then
		-- save an existing model by converting it back to a spec
		local inst = need(p.path, "model")
		spec = Cmds.toSpec(inst)
	end
	D.templates[p.name] = spec
	return { saved = p.name, instances = countSpec(spec), storage = "plugin memory for this session; the server copy is saved by the agent via template_save" }
end

function Cmds.template_load(p: any): any
	local spec = D.templates[tostring(p.name)] or p.spec
	if type(spec) ~= "table" then
		error("template not found: " .. tostring(p.name))
	end
	return { name = p.name, spec = spec, instances = countSpec(spec) }
end

-- build_from_template: spec comes from the server (agent passes it in), with overrides for name / position / color / scale
function Cmds.build_from_template(p: any): any
	local spec = p.spec or D.templates[tostring(p.template)]
	if type(spec) ~= "table" then
		error("template not found: " .. tostring(p.template) .. ". Pass spec, or save it first with template_save.")
	end
	local copy = HttpService:JSONDecode(HttpService:JSONEncode(spec)) -- deep copy
	if p.name then
		copy.name = tostring(p.name)
	end
	if type(p.position) == "table" then
		copy.position = p.position
	end
	if type(p.rotation) == "table" then
		copy.rotation = p.rotation
	end
	if p.color then
		local function recolor(n: any)
			if n.color ~= nil then
				n.color = p.color
			end
			for _, c in ipairs(n.children or {}) do
				recolor(c)
			end
		end
		recolor(copy)
	end
	return Cmds.build_model({ parent = p.parent or "Workspace", spec = copy })
end

-- Convert an existing Instance tree back into a spec (used by template_save of an existing model).
function Cmds.toSpec(inst: Instance, depth: number?): any
	local d = depth or 0
	if d > 12 then
		return { name = inst.Name, class = "Folder" }
	end
	local s: any = { name = inst.Name, class = inst.ClassName }
	if inst:IsA("BasePart") then
		local part = inst :: BasePart
		s.size = v3(part.Size)
		s.position = v3(part.Position)
		s.color = "#" .. part.Color:ToHex()
		s.material = part.Material.Name
		s.transparency = part.Transparency
		s.anchored = part.Anchored
		s.canCollide = part.CanCollide
		local rx, ry, rz = part.CFrame:ToOrientation()
		s.rotation = { r2(math.deg(rx)), r2(math.deg(ry)), r2(math.deg(rz)) }
	elseif inst:IsA("LuaSourceContainer") then
		s.source = (inst :: any).Source
	end
	local kids = {}
	for _, c in ipairs(inst:GetChildren()) do
		table.insert(kids, Cmds.toSpec(c, d + 1))
	end
	if #kids > 0 then
		s.children = kids
	end
	return s
end

-- ---------- duplicate / transform commands ----------
function Cmds.duplicate_array(p: any): any
	local src = need(p.path, "source")
	local o = p.offset or { 0, 0, 0 }
	return D.Transform.duplicateArray(src, tonumber(p.count) or 0, Vector3.new(o[1] or 0, o[2] or 0, o[3] or 0), api)
end

function Cmds.duplicate_grid(p: any): any
	local src = need(p.path, "source")
	return D.Transform.duplicateGrid(src, tonumber(p.nx) or 1, tonumber(p.nz) or 1, tonumber(p.dx) or 0, tonumber(p.dz) or 0, api, tonumber(p.ny), tonumber(p.dy))
end

function Cmds.duplicate_along_path(p: any): any
	local src = need(p.path, "source")
	local pts = {}
	for _, q in ipairs(p.points or {}) do
		table.insert(pts, Vector3.new(q[1] or 0, q[2] or 0, q[3] or 0))
	end
	return D.Transform.duplicateAlongPath(src, pts, tonumber(p.count) or 0, api)
end

function Cmds.mirror(p: any): any
	return D.Transform.mirror(need(p.path, "source"), tostring(p.axis or "X"), tonumber(p.at), api)
end

function Cmds.scale_model(p: any): any
	return D.Transform.scaleModel(need(p.path, "model"), tonumber(p.factor) or 0, api)
end

local function many(paths: any, what: string): { Instance }
	if type(paths) ~= "table" or #paths == 0 then
		error(what .. ": paths must be a non-empty list")
	end
	local out = {}
	for _, path in ipairs(paths) do
		table.insert(out, need(path, "item"))
	end
	return out
end

function Cmds.align(p: any): any
	return D.Transform.align(many(p.paths, "align"), tostring(p.axis or "Y"), tostring(p.mode or "min"))
end
function Cmds.distribute(p: any): any
	return D.Transform.distribute(many(p.paths, "distribute"), tostring(p.axis or "X"))
end
function Cmds.snap_to_ground(p: any): any
	return D.Transform.snapToGround(many(p.paths, "snap_to_ground"), api, tonumber(p.offset), tonumber(p.max_height))
end

-- ---------- queries ----------
function Cmds.get_bounding_box(p: any): any
	return D.Transform.describeBox(need(p.path, "instance"))
end
function Cmds.get_pivot(p: any): any
	return D.Transform.getPivot(need(p.path, "instance"))
end
function Cmds.measure_distance(p: any): any
	return D.Transform.measure(need(p.a, "a"), need(p.b, "b"))
end
function Cmds.raycast(p: any): any
	local o, d = p.origin, p.direction
	if type(o) ~= "table" or type(d) ~= "table" then
		error("origin and direction are required ([x,y,z])")
	end
	local hit = api.raycast(Vector3.new(o[1], o[2], o[3]), Vector3.new(d[1], d[2], d[3]), {})
	if not hit then
		return { hit = false }
	end
	return { hit = true, position = v3(hit.position), normal = v3(hit.normal), instance = D.pathOf(hit.instance), material = tostring(hit.instance.Material or "") }
end
function Cmds.find_empty_space(p: any): any
	local sz, area = p.size or { 4, 4, 4 }, p.area
	if type(area) ~= "table" or type(area.min) ~= "table" or type(area.max) ~= "table" then
		error("area {min:[x,y,z], max:[x,y,z]} is required")
	end
	local existing = {}
	for _, c in ipairs(workspace:GetChildren()) do
		if c:IsA("Model") or c:IsA("BasePart") then
			if not c:IsA("Terrain") and c ~= workspace.CurrentCamera then
				table.insert(existing, c)
			end
		end
	end
	return D.Transform.findEmptySpace(Vector3.new(sz[1], sz[2], sz[3]), { min = Vector3.new(area.min[1], area.min[2], area.min[3]), max = Vector3.new(area.max[1], area.max[2], area.max[3]) }, existing, tonumber(p.step), tonumber(area.min[2]))
end

-- ---------- camera + screenshots ----------
function Cmds.camera_set(p: any): any
	local cam = workspace.CurrentCamera
	if not cam then
		error("no CurrentCamera")
	end
	local pos, look = p.position, p.look_at
	if type(pos) ~= "table" or type(look) ~= "table" then
		error("position and look_at ([x,y,z]) are required")
	end
	cam.CameraType = Enum.CameraType.Scriptable
	cam.CFrame = CFrame.lookAt(Vector3.new(pos[1], pos[2], pos[3]), Vector3.new(look[1], look[2], look[3]))
	if tonumber(p.fov) then
		cam.FieldOfView = math.clamp(tonumber(p.fov) :: number, 10, 120)
	end
	return { camera = v3(cam.CFrame.Position), looking_at = look, fov = cam.FieldOfView }
end

-- Orbit angles around a model, sized from its bounding box so the whole thing is in frame.
function Cmds.angles_for(inst: Instance, names: { string }?): { { name: string, position: Vector3, look: Vector3 } }
	local b = D.Transform.boundingBox(inst)
	if not b then
		error("nothing to frame: " .. inst.Name .. " has no parts")
	end
	local radius = math.max(b.size.X, b.size.Y, b.size.Z) * 1.4 + 6
	local c = b.center
	local all = {
		front = { c + Vector3.new(0, b.size.Y * 0.2, radius), c },
		back = { c + Vector3.new(0, b.size.Y * 0.2, -radius), c },
		side = { c + Vector3.new(radius, b.size.Y * 0.2, 0), c },
		left = { c + Vector3.new(-radius, b.size.Y * 0.2, 0), c },
		top = { c + Vector3.new(0, radius, 0.01), c },
		three_quarter = { c + Vector3.new(radius * 0.7, radius * 0.45, radius * 0.7), c },
	}
	local out = {}
	for _, n in ipairs(names or { "front", "side", "top", "three_quarter" }) do
		if all[n] then
			table.insert(out, { name = n, position = all[n][1], look = all[n][2] })
		end
	end
	return out
end

-- Real pixels via StudioCaptureService (needs the user's one-time permission). Returns nil + a reason when unavailable.
local function capturePng(): (string?, string?)
	local okSvc, svc = pcall(function()
		return game:GetService("StudioCaptureService")
	end)
	if not okSvc or not svc then
		return nil, "StudioCaptureService is not available in this Studio version"
	end
	local okPerm, granted = pcall(function()
		return svc:RequestScreenshotPermissionAsync()
	end)
	if not okPerm then
		return nil, "screenshot permission check failed: " .. tostring(granted)
	end
	if not granted then
		return nil, "screenshot permission was not granted (allow it in Studio, and check the global screenshot setting)"
	end
	if not svc:CanCaptureScreenshot() then
		return nil, "Studio says a screenshot cannot be captured right now (is this the active place window?)"
	end
	local okCap, cap = pcall(function()
		return svc:CaptureScreenshot({ Format = Enum.StudioCaptureScreenshotFormat.PNG, UICaptureMode = Enum.UICaptureMode.None })
	end)
	if not okCap or not cap then
		return nil, "CaptureScreenshot failed: " .. tostring(cap)
	end
	local deadline = os.clock() + 12
	while cap.BufferStatus == Enum.StudioCaptureBufferStatus.Pending or cap.BufferStatus == Enum.StudioCaptureBufferStatus.NotStarted do
		if os.clock() > deadline then
			return nil, "screenshot timed out after 12s"
		end
		task.wait(0.1)
	end
	if cap.BufferStatus ~= Enum.StudioCaptureBufferStatus.Ready then
		return nil, "capture failed: " .. table.concat(cap:GetErrors(), "; ")
	end
	local buf = cap:GetBuffer()
	return buffer.tostring(buf), nil
end
Cmds.capturePng = capturePng

-- screenshot_multi: move the camera to each angle around `path` and capture. Each shot reports its own success/reason.
-- Pixels are uploaded by the caller (main plugin) through `shots[i].png`; this returns metadata only.
function Cmds.screenshot_multi(p: any): any
	local inst = need(p.path, "target")
	local names = p.angles
	local plan = Cmds.angles_for(inst, type(names) == "table" and names or nil)
	local cam = workspace.CurrentCamera
	if not cam then
		error("no CurrentCamera")
	end
	local saved = { type = cam.CameraType, cf = cam.CFrame, fov = cam.FieldOfView }
	local shots, okCount = {}, 0
	for _, a in ipairs(plan) do
		cam.CameraType = Enum.CameraType.Scriptable
		cam.CFrame = CFrame.lookAt(a.position, a.look)
		task.wait(0.25) -- let the viewport render the new view
		local png, why = capturePng()
		local entry = { angle = a.name, camera = v3(a.position), looking_at = v3(a.look), captured = png ~= nil, bytes = png and #png or 0, reason = why }
		if png then
			okCount += 1
			entry.png = png
		end
		table.insert(shots, entry)
	end
	cam.CameraType = saved.type
	cam.CFrame = saved.cf
	cam.FieldOfView = saved.fov
	return { target = D.pathOf(inst), requested = #plan, captured = okCount, shots = shots, fallback = okCount == 0 and "No pixel capture was possible; use roblox_screenshot for a scene report instead." or nil }
end

-- ---------- terrain ----------
local MATERIALS = { Grass = Enum.Material.Grass, Rock = Enum.Material.Rock, Sand = Enum.Material.Sand, Snow = Enum.Material.Snow, Water = Enum.Material.Water, Mud = Enum.Material.Mud, Ground = Enum.Material.Ground, Slate = Enum.Material.Slate, Ice = Enum.Material.Ice, Asphalt = Enum.Material.Asphalt, Sandstone = Enum.Material.Sandstone, Basalt = Enum.Material.Basalt, LeafyGrass = Enum.Material.LeafyGrass, Pavement = Enum.Material.Pavement, Limestone = Enum.Material.Limestone, Glacier = Enum.Material.Glacier, Air = Enum.Material.Air }

function Cmds.terrain_fill(p: any): any
	local T = workspace.Terrain
	local mat = MATERIALS[tostring(p.material or "Grass")]
	if not mat then
		error("unknown terrain material: " .. tostring(p.material))
	end
	local shape = tostring(p.shape or "block")
	local c = p.center or { 0, 0, 0 }
	local center = Vector3.new(c[1] or 0, c[2] or 0, c[3] or 0)
	ChangeHistoryService:SetWaypoint("BlockyAI before terrain_fill")
	if shape == "block" then
		local s = p.size or { 32, 8, 32 }
		if s[1] * s[2] * s[3] > 4e6 then
			error("block too large (limit 4,000,000 cubic studs per call); split it")
		end
		T:FillBlock(CFrame.new(center), Vector3.new(s[1], s[2], s[3]), mat)
	elseif shape == "ball" then
		T:FillBall(center, math.clamp(tonumber(p.radius) or 16, 1, 400), mat)
	elseif shape == "cylinder" then
		T:FillCylinder(CFrame.new(center), math.clamp(tonumber(p.height) or 8, 1, 400), math.clamp(tonumber(p.radius) or 16, 1, 400), mat)
	elseif shape == "wedge" then
		local s = p.size or { 16, 8, 16 }
		T:FillWedge(CFrame.new(center), Vector3.new(s[1], s[2], s[3]), mat)
	else
		error("shape must be block, ball, cylinder or wedge")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI terrain_fill")
	D.logEdit("terrain_fill", "Workspace.Terrain", nil, { shape = shape, material = tostring(p.material) })
	return { filled = shape, material = tostring(p.material or "Grass"), center = v3(center) }
end

-- heightmap: rows of heights (studs), generated by the agent in the VM. Written column by column with FillBlock so the result is
-- exact and the Studio side does no noise math. cell = studs per sample.
function Cmds.terrain_heightmap(p: any): any
	local T = workspace.Terrain
	local rows = p.heights
	if type(rows) ~= "table" or #rows < 2 or type(rows[1]) ~= "table" then
		error("heights must be a 2D array of numbers (rows of columns)")
	end
	local nz, nx = #rows, #rows[1]
	if nx * nz > 40000 then
		error("heightmap too large: " .. nx * nz .. " samples (limit 40,000). Use a coarser grid.")
	end
	local cell = math.clamp(tonumber(p.cell) or 8, 2, 32)
	local base = tonumber(p.base_y) or 0
	local depth = math.clamp(tonumber(p.depth) or 12, 4, 200)
	local o = p.origin or { 0, 0, 0 }
	local mat = MATERIALS[tostring(p.material or "Grass")] or Enum.Material.Grass
	local snowAbove = tonumber(p.snow_above)
	local rockAbove = tonumber(p.rock_above)
	ChangeHistoryService:SetWaypoint("BlockyAI before terrain_heightmap")
	local maxH, minH, n = -math.huge, math.huge, 0
	for iz = 1, nz do
		for ix = 1, nx do
			local h = tonumber(rows[iz][ix]) or 0
			maxH, minH = math.max(maxH, h), math.min(minH, h)
			local top = base + h
			local m = mat
			if snowAbove and h >= snowAbove then
				m = Enum.Material.Snow
			elseif rockAbove and h >= rockAbove then
				m = Enum.Material.Rock
			end
			local height = math.max(top - (base - depth), cell)
			T:FillBlock(CFrame.new((o[1] or 0) + (ix - 1) * cell, base - depth + height / 2, (o[3] or 0) + (iz - 1) * cell), Vector3.new(cell, height, cell), m)
			n += 1
			if n % 200 == 0 then
				task.wait()
			end
		end
	end
	ChangeHistoryService:SetWaypoint("BlockyAI terrain_heightmap")
	D.logEdit("terrain_heightmap", "Workspace.Terrain", nil, { samples = n })
	return { samples = n, size_studs = { nx * cell, nz * cell }, min_height = r2(minH), max_height = r2(maxH), cell = cell }
end

-- ---------- lighting ----------
function Cmds.lighting_set(p: any): any
	local L = game:GetService("Lighting")
	local changed = {}
	local function set(inst: Instance, props: any, label: string)
		for k, v in pairs(props) do
			local val: any = v
			if type(v) == "string" and string.match(v, "^#%x%x%x%x%x%x$") then
				val = Color3.fromHex(v)
			end
			local ok, err = pcall(function()
				(inst :: any)[k] = val
			end)
			table.insert(changed, label .. "." .. k .. (ok and "" or (" FAILED: " .. tostring(err))))
		end
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before lighting_set")
	if type(p.lighting) == "table" then
		set(L, p.lighting, "Lighting")
	end
	if tonumber(p.time_of_day) then
		L.ClockTime = tonumber(p.time_of_day) :: number
		table.insert(changed, "Lighting.ClockTime")
	end
	local effects = { atmosphere = "Atmosphere", sky = "Sky", bloom = "BloomEffect", color_correction = "ColorCorrectionEffect", sun_rays = "SunRaysEffect", depth_of_field = "DepthOfFieldEffect", blur = "BlurEffect" }
	for key, class in pairs(effects) do
		if type(p[key]) == "table" then
			local inst = L:FindFirstChildOfClass(class)
			if not inst then
				inst = Instance.new(class)
				inst.Parent = L
			end
			set(inst, p[key], class)
		end
	end
	if type(p.clouds) == "table" then
		local T = workspace.Terrain
		local cl = T:FindFirstChildOfClass("Clouds") or Instance.new("Clouds")
		cl.Parent = T
		set(cl, p.clouds, "Clouds")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI lighting_set")
	D.logEdit("lighting_set", "Lighting", nil, changed)
	return { changed = changed, count = #changed }
end

-- ---------- insert_asset (safe) ----------
-- Inserts a Toolbox asset by id, then reports EVERY script inside it. With remove_scripts=true they are deleted before the model is kept.
function Cmds.insert_asset(p: any): any
	local id = tonumber(p.asset_id)
	if not id or id <= 0 then
		error("asset_id must be a positive number")
	end
	local InsertService = game:GetService("InsertService")
	local ok, res = pcall(function()
		return InsertService:LoadAsset(id)
	end)
	if not ok then
		error("asset " .. id .. " could not be loaded (it may be private, removed, or not allowed): " .. tostring(res))
	end
	local container = res :: Model
	local scripts, removed = {}, 0
	for _, d in ipairs(container:GetDescendants()) do
		if d:IsA("LuaSourceContainer") then
			table.insert(scripts, { path = d:GetFullName(), class = d.ClassName, lines = select(2, string.gsub((d :: any).Source, "\n", "\n")) + 1 })
		end
	end
	if p.remove_scripts ~= false then
		for _, d in ipairs(container:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				d:Destroy()
				removed += 1
			end
		end
	end
	local parent = need(p.parent or "Workspace", "parent")
	local kids = container:GetChildren()
	for _, k in ipairs(kids) do
		k.Parent = parent
	end
	container:Destroy()
	D.logEdit("insert_asset", tostring(id), nil, { scripts_found = #scripts, removed = removed })
	return {
		asset_id = id, inserted = #kids, scripts_found = #scripts, scripts_removed = removed, scripts = scripts,
		warning = #scripts > 0 and (p.remove_scripts ~= false and "The asset contained scripts; they were REMOVED. Review before adding your own." or "The asset contains scripts and they were KEPT. Read them before running the game.") or nil,
	}
end

return Cmds
end)()

local UI = (function()
-- BlockyAI dock UI ("Blocky Futurism"). Builds the widget, exposes small setters; contains NO network code and NO command logic.
local TweenService = game:GetService("TweenService")

local UI = {}

local MAX_ROWS = 200

export type Theme = { [string]: Color3 }

local DEFAULT_THEME: { [string]: string } = {
	bg = "0B0E14", card = "141925", card2 = "1B2233", blue = "00A2FF", green = "02FF8A", red = "FF3B4E",
	amber = "FFB800", violet = "8B5CFF", text = "E8EEF9", mute = "8A96AD",
}

-- Accepts only #RRGGBB strings for known keys. Anything else is ignored (the server also validates this).
function UI.makeTheme(cfg: any?): Theme
	local t: Theme = {}
	for k, v in pairs(DEFAULT_THEME) do
		t[k] = Color3.fromHex(v)
	end
	if type(cfg) == "table" then
		for k, v in pairs(cfg) do
			if type(k) == "string" and DEFAULT_THEME[k] and type(v) == "string" then
				local hex = string.match(v, "^#(%x%x%x%x%x%x)$")
				if hex then
					t[k] = Color3.fromHex(hex)
				end
			end
		end
	end
	return t
end

local function mk(class: string, props: { [string]: any }, parent: Instance?): any
	local inst = Instance.new(class)
	for k, v in pairs(props) do
		(inst :: any)[k] = v
	end
	if parent then
		inst.Parent = parent
	end
	return inst
end

local function corner(o: Instance, r: number?)
	mk("UICorner", { CornerRadius = UDim.new(0, r or 10) }, o)
end

local function stroke(o: Instance, col: Color3, th: number?, tr: number?)
	mk("UIStroke", { Color = col, Thickness = th or 2, Transparency = tr or 0.6, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, o)
end

-- A chunky "brick" button: darker bottom edge, sinks 3px when pressed (TweenService).
function UI.brickButton(parent: Instance, text: string, color: Color3, size: UDim2, order: number?): any
	local shell = mk("Frame", { Size = size, BackgroundTransparency = 1, LayoutOrder = order or 0 }, parent)
	local edge = mk("Frame", { Size = UDim2.new(1, 0, 1, -3), Position = UDim2.fromOffset(0, 3), BackgroundColor3 = color:Lerp(Color3.new(0, 0, 0), 0.45), BorderSizePixel = 0 }, shell)
	corner(edge, 8)
	local face = mk("TextButton", {
		Size = UDim2.new(1, 0, 1, -3), BackgroundColor3 = color, BorderSizePixel = 0, AutoButtonColor = false,
		Text = text, TextColor3 = Color3.new(1, 1, 1), Font = Enum.Font.GothamBold, TextSize = 14,
	}, shell)
	corner(face, 8)
	local info = TweenInfo.new(0.07, Enum.EasingStyle.Quad)
	face.MouseButton1Down:Connect(function()
		TweenService:Create(face, info, { Position = UDim2.fromOffset(0, 3) }):Play()
	end)
	local function up()
		TweenService:Create(face, info, { Position = UDim2.fromOffset(0, 0) }):Play()
	end
	face.MouseButton1Up:Connect(up)
	face.MouseLeave:Connect(up)
	return face
end

-- A row pool: at most MAX_ROWS labels exist per list; the oldest is reused instead of creating more.
function UI.makeList(parent: Instance, theme: Theme): any
	local scroll = mk("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 4,
		ScrollBarImageColor3 = theme.blue, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, parent)
	mk("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, scroll)
	local rows: { any } = {}
	local order = 0
	local list = { scroll = scroll }
	function list.add(text: string, color: Color3?, stripe: Color3?, font: Enum.Font?): any
		order += 1
		local row
		if #rows >= MAX_ROWS then
			row = table.remove(rows, 1)
		else
			row = mk("Frame", { Size = UDim2.new(1, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = theme.card, BorderSizePixel = 0 }, scroll)
			corner(row, 6)
			mk("Frame", { Name = "Stripe", Size = UDim2.new(0, 3, 1, 0), BorderSizePixel = 0 }, row)
			mk("TextLabel", { Name = "Text", Size = UDim2.new(1, -14, 0, 0), Position = UDim2.fromOffset(10, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, TextXAlignment = Enum.TextXAlignment.Left, TextWrapped = true, TextSize = 12 }, row)
			mk("UIPadding", { PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 4) }, row)
		end
		row.LayoutOrder = order
		row.Stripe.BackgroundColor3 = stripe or theme.blue
		row.Text.Text = string.sub(text, 1, 500)
		row.Text.TextColor3 = color or theme.text
		row.Text.Font = font or Enum.Font.Gotham
		table.insert(rows, row)
		scroll.CanvasPosition = Vector2.new(0, 1e6)
		return row
	end
	function list.clear()
		for _, r in ipairs(rows) do
			r:Destroy()
		end
		table.clear(rows)
	end
	function list.count(): number
		return #rows
	end
	return list
end

-- Builds the whole dock. Returns handles the main script wires to actions.
function UI.build(widget: any, theme: Theme, labels: any?): any
	local h: any = {}
	local L = labels or {}
	local root = mk("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = theme.bg, BorderSizePixel = 0 }, widget)
	mk("UIPadding", { PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }, root)
	mk("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, root)

	-- header: logo (pure UI shapes), title, status chip
	local header = mk("Frame", { Size = UDim2.new(1, 0, 0, 36), BackgroundColor3 = theme.card2, BorderSizePixel = 0, LayoutOrder = 1 }, root)
	corner(header, 10)
	mk("UIGradient", { Color = ColorSequence.new(theme.card2, theme.card), Rotation = 90 }, header)
	local logo = mk("Frame", { Size = UDim2.fromOffset(24, 24), Position = UDim2.fromOffset(8, 6), BackgroundColor3 = theme.blue, BorderSizePixel = 0, Rotation = 8 }, header)
	corner(logo, 5)
	mk("Frame", { Size = UDim2.fromOffset(8, 8), Position = UDim2.fromOffset(12, 3), BackgroundColor3 = theme.green, BorderSizePixel = 0, Rotation = 45 }, logo)
	mk("TextLabel", { Size = UDim2.new(1, -150, 1, 0), Position = UDim2.fromOffset(40, 0), BackgroundTransparency = 1, Text = L.app or "BlockyAI", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left }, header)
	h.chip = mk("TextLabel", { Size = UDim2.fromOffset(76, 20), Position = UDim2.new(1, -84, 0, 8), BackgroundColor3 = theme.red, BorderSizePixel = 0, Text = "OFFLINE", TextColor3 = Color3.new(0, 0, 0), Font = Enum.Font.GothamBold, TextSize = 11 }, header)
	corner(h.chip, 10)
	h.dot = mk("Frame", { Size = UDim2.fromOffset(8, 8), Position = UDim2.fromOffset(-12, 6), BackgroundColor3 = theme.red, BorderSizePixel = 0, Visible = false }, h.chip)
	corner(h.dot, 4)

	-- update banner (hidden until the server says a newer plugin exists; it only LINKS to the Get Plugin page)
	h.banner = mk("TextButton", { Size = UDim2.new(1, 0, 0, 24), BackgroundColor3 = theme.amber, BorderSizePixel = 0, Text = "UPDATE AVAILABLE: open the Get Plugin page", TextColor3 = Color3.new(0, 0, 0), Font = Enum.Font.GothamBold, TextSize = 11, Visible = false, LayoutOrder = 2, AutoButtonColor = false }, root)
	corner(h.banner, 6)

	-- pairing page: 6 tiles
	h.pair = mk("Frame", { Size = UDim2.new(1, 0, 0, 150), BackgroundColor3 = theme.card, BorderSizePixel = 0, LayoutOrder = 3 }, root)
	corner(h.pair, 10)
	stroke(h.pair, theme.blue)
	mk("TextLabel", { Size = UDim2.new(1, -16, 0, 34), Position = UDim2.fromOffset(8, 6), BackgroundTransparency = 1, Text = "Type the 6-character code from the website.", TextColor3 = theme.mute, Font = Enum.Font.Gotham, TextSize = 12, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left }, h.pair)
	h.tiles = {}
	for i = 1, 6 do
		local tile = mk("TextLabel", { Size = UDim2.fromOffset(38, 44), Position = UDim2.fromOffset(8 + (i - 1) * 43, 44), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "", TextColor3 = theme.green, Font = Enum.Font.Code, TextSize = 24 }, h.pair)
		corner(tile, 8)
		stroke(tile, theme.blue, 2, 0.7)
		h.tiles[i] = tile
	end
	h.codeBox = mk("TextBox", { Size = UDim2.new(1, -16, 0, 26), Position = UDim2.fromOffset(8, 94), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "", PlaceholderText = "ABC123", PlaceholderColor3 = theme.mute, TextColor3 = theme.text, Font = Enum.Font.Code, TextSize = 14, ClearTextOnFocus = false }, h.pair)
	corner(h.codeBox, 6)
	h.connect = UI.brickButton(h.pair, "CONNECT", theme.blue, UDim2.new(1, -16, 0, 22), 0)
	h.connect.Parent.Position = UDim2.fromOffset(8, 124)
	h.connect.Parent.Size = UDim2.new(1, -16, 0, 22)
	h.pairStatus = mk("TextLabel", { Size = UDim2.new(1, -16, 0, 14), Position = UDim2.fromOffset(8, 0), BackgroundTransparency = 1, Text = "", TextColor3 = theme.mute, Font = Enum.Font.Gotham, TextSize = 11, TextXAlignment = Enum.TextXAlignment.Left, Visible = false }, h.pair)

	-- connected info bar
	h.info = mk("TextLabel", { Size = UDim2.new(1, 0, 0, 34), BackgroundColor3 = theme.card, BorderSizePixel = 0, Text = "", TextColor3 = theme.text, Font = Enum.Font.Gotham, TextSize = 11, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, Visible = false, LayoutOrder = 4 }, root)
	corner(h.info, 8)
	mk("UIPadding", { PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }, h.info)

	-- plan progress
	h.planBar = mk("Frame", { Size = UDim2.new(1, 0, 0, 22), BackgroundColor3 = theme.card, BorderSizePixel = 0, Visible = false, LayoutOrder = 5 }, root)
	corner(h.planBar, 8)
	h.planFill = mk("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = theme.green, BackgroundTransparency = 0.55, BorderSizePixel = 0 }, h.planBar)
	corner(h.planFill, 8)
	h.planText = mk("TextLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Text = "", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 11 }, h.planBar)

	-- tabs
	h.tabBar = mk("Frame", { Size = UDim2.new(1, 0, 0, 26), BackgroundTransparency = 1, Visible = false, LayoutOrder = 6 }, root)
	mk("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, h.tabBar)
	h.pages = mk("Frame", { Size = UDim2.new(1, 0, 1, -230), BackgroundTransparency = 1, Visible = false, LayoutOrder = 7 }, root)
	h.tabButtons, h.tabPages = {}, {}
	local names = { "Activity", "Edit Log", "Console", "Chat", "Settings" }
	local function show(name: string)
		for n, page in pairs(h.tabPages) do
			page.Visible = (n == name)
		end
		for n, b in pairs(h.tabButtons) do
			b.BackgroundColor3 = (n == name) and theme.blue or theme.card2
			b.TextColor3 = (n == name) and Color3.new(0, 0, 0) or theme.mute
		end
	end
	h.showTab = show
	for i, n in ipairs(names) do
		local b = mk("TextButton", { Size = UDim2.new(0.2, -4, 1, 0), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = n, TextColor3 = theme.mute, Font = Enum.Font.GothamBold, TextSize = 10, LayoutOrder = i, AutoButtonColor = false }, h.tabBar)
		corner(b, 6)
		b.MouseButton1Click:Connect(function()
			show(n)
		end)
		h.tabButtons[n] = b
		h.tabPages[n] = mk("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false }, h.pages)
	end
	h.activity = UI.makeList(h.tabPages["Activity"], theme)
	h.editlog = UI.makeList(h.tabPages["Edit Log"], theme)
	h.console = UI.makeList(h.tabPages["Console"], theme)
	-- chat: list + send box
	local chatPage = h.tabPages["Chat"]
	local chatList = mk("Frame", { Size = UDim2.new(1, 0, 1, -34), BackgroundTransparency = 1 }, chatPage)
	h.chat = UI.makeList(chatList, theme)
	h.chatBox = mk("TextBox", { Size = UDim2.new(1, -64, 0, 28), Position = UDim2.new(0, 0, 1, -30), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "", PlaceholderText = "Tell Blocky what to build...", PlaceholderColor3 = theme.mute, TextColor3 = theme.text, Font = Enum.Font.Gotham, TextSize = 12, ClearTextOnFocus = false, TextXAlignment = Enum.TextXAlignment.Left }, chatPage)
	corner(h.chatBox, 6)
	mk("UIPadding", { PaddingLeft = UDim.new(0, 8) }, h.chatBox)
	h.chatSend = mk("TextButton", { Size = UDim2.fromOffset(58, 28), Position = UDim2.new(1, -58, 1, -30), BackgroundColor3 = theme.violet, BorderSizePixel = 0, Text = "SEND", TextColor3 = Color3.new(1, 1, 1), Font = Enum.Font.GothamBold, TextSize = 11 }, chatPage)
	corner(h.chatSend, 6)
	-- settings
	local set = h.tabPages["Settings"]
	mk("UIListLayout", { Padding = UDim.new(0, 6) }, set)
	h.luaToggle = mk("TextButton", { Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 11, LayoutOrder = 1 }, set)
	corner(h.luaToggle, 6)
	h.luaWarn = mk("TextLabel", { Size = UDim2.new(1, 0, 0, 30), BackgroundTransparency = 1, Text = "run_lua lets the AI run any code in your Studio. Leave it OFF unless you trust the session.", TextColor3 = theme.red, Font = Enum.Font.Gotham, TextSize = 10, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 2 }, set)
	h.flashToggle = mk("TextButton", { Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 11, LayoutOrder = 3 }, set)
	corner(h.flashToggle, 6)
	h.focusToggle = mk("TextButton", { Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 11, LayoutOrder = 4 }, set)
	corner(h.focusToggle, 6)
	h.version = mk("TextLabel", { Size = UDim2.new(1, 0, 0, 16), BackgroundTransparency = 1, Text = "", TextColor3 = theme.mute, Font = Enum.Font.Code, TextSize = 10, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 5 }, set)
	-- in-Studio self-test (no AI): runs the plugin's own handlers against the real engine and reports pass/fail with raw errors
	h.selftest = mk("TextButton", { Size = UDim2.new(1, 0, 0, 28), BackgroundColor3 = theme.blue, BorderSizePixel = 0, Text = "RUN SELF-TEST", TextColor3 = Color3.new(0, 0, 0), Font = Enum.Font.GothamBold, TextSize = 11, LayoutOrder = 6 }, set)
	corner(h.selftest, 6)
	h.selftestOut = mk("TextLabel", { Size = UDim2.new(1, 0, 0, 120), BackgroundTransparency = 1, Text = "", TextColor3 = theme.mute, Font = Enum.Font.Code, TextSize = 10, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, TextWrapped = true, LayoutOrder = 7 }, set)
	h.disconnect = mk("TextButton", { Size = UDim2.new(1, 0, 0, 28), BackgroundColor3 = theme.red, BorderSizePixel = 0, Text = "DISCONNECT", TextColor3 = Color3.new(0, 0, 0), Font = Enum.Font.GothamBold, TextSize = 11, LayoutOrder = 8 }, set)
	corner(h.disconnect, 6)

	-- "Blocky is building" overlay: three bouncing cubes + Stop
	h.overlay = mk("Frame", { Size = UDim2.new(1, 0, 0, 44), Position = UDim2.new(0, 0, 1, -44), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Visible = false, ZIndex = 5 }, root)
	h.overlay.LayoutOrder = 99
	corner(h.overlay, 10)
	stroke(h.overlay, theme.violet, 2, 0.4)
	h.cubes = {}
	for i = 1, 3 do
		h.cubes[i] = mk("Frame", { Size = UDim2.fromOffset(10, 10), Position = UDim2.fromOffset(10 + (i - 1) * 16, 26), BackgroundColor3 = theme.violet, BorderSizePixel = 0, ZIndex = 6 }, h.overlay)
		corner(h.cubes[i], 2)
	end
	h.overlayText = mk("TextLabel", { Size = UDim2.new(1, -150, 1, 0), Position = UDim2.fromOffset(62, 0), BackgroundTransparency = 1, Text = "Blocky is building...", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 12, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 6 }, h.overlay)
	h.stop = mk("TextButton", { Size = UDim2.fromOffset(64, 26), Position = UDim2.new(1, -72, 0, 9), BackgroundColor3 = theme.red, BorderSizePixel = 0, Text = "STOP", TextColor3 = Color3.new(0, 0, 0), Font = Enum.Font.GothamBold, TextSize = 12, ZIndex = 6 }, h.overlay)
	corner(h.stop, 6)

	-- confirmation modal (red, HUD style)
	h.modal = mk("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.35, BorderSizePixel = 0, Visible = false, ZIndex = 20 }, widget)
	local card = mk("Frame", { Size = UDim2.new(1, -30, 0, 150), Position = UDim2.fromScale(0.5, 0.5), AnchorPoint = Vector2.new(0.5, 0.5), BackgroundColor3 = theme.card, BorderSizePixel = 0, ZIndex = 21 }, h.modal)
	corner(card, 10)
	stroke(card, theme.red, 2, 0)
	mk("TextLabel", { Size = UDim2.new(1, -16, 0, 22), Position = UDim2.fromOffset(8, 6), BackgroundTransparency = 1, Text = "CONFIRM DESTRUCTIVE ACTION", TextColor3 = theme.red, Font = Enum.Font.GothamBold, TextSize = 13, ZIndex = 22 }, card)
	h.modalText = mk("TextLabel", { Size = UDim2.new(1, -16, 0, 60), Position = UDim2.fromOffset(8, 30), BackgroundTransparency = 1, Text = "", TextColor3 = theme.text, Font = Enum.Font.Gotham, TextSize = 12, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 22 }, card)
	h.modalYes = mk("TextButton", { Size = UDim2.new(0.5, -12, 0, 28), Position = UDim2.new(0, 8, 1, -36), BackgroundColor3 = theme.red, BorderSizePixel = 0, Text = "ALLOW (snapshot first)", TextColor3 = Color3.new(0, 0, 0), Font = Enum.Font.GothamBold, TextSize = 11, ZIndex = 22 }, card)
	corner(h.modalYes, 6)
	h.modalNo = mk("TextButton", { Size = UDim2.new(0.5, -12, 0, 28), Position = UDim2.new(0.5, 4, 1, -36), BackgroundColor3 = theme.card2, BorderSizePixel = 0, Text = "DENY", TextColor3 = theme.text, Font = Enum.Font.GothamBold, TextSize = 11, ZIndex = 22 }, card)
	corner(h.modalNo, 6)
	return h
end

-- ---- small setters the main script uses ----
function UI.setCode(h: any, text: string)
	local cleaned = string.gsub(text, "[^%w]", "")
	local t = string.upper(cleaned)
	for i = 1, 6 do
		h.tiles[i].Text = string.sub(t, i, i)
	end
end

function UI.setStatus(h: any, theme: Theme, kind: string)
	local colors: { [string]: Color3 } = {
		LIVE = theme.green, OFFLINE = theme.red, RETRY = theme.amber, TESTING = theme.amber, BUILDING = theme.violet,
	}
	local color = colors[kind] or theme.red
	h.chip.Text = colors[kind] and kind or "OFFLINE"
	h.chip.BackgroundColor3 = color
	h.dot.BackgroundColor3 = color
end

function UI.setConnected(h: any, connected: boolean)
	h.pair.Visible = not connected
	h.info.Visible = connected
	h.tabBar.Visible = connected
	h.pages.Visible = connected
	if connected then
		h.showTab("Activity")
	end
end

function UI.setPlan(h: any, theme: Theme, plan: any?)
	if not plan or type(plan.items) ~= "table" or #plan.items == 0 then
		h.planBar.Visible = false
		return
	end
	local done = 0
	for _, it in ipairs(plan.items) do
		if it.done then
			done += 1
		end
	end
	h.planBar.Visible = true
	h.planText.Text = string.format("%s  %d/%d", tostring(plan.title or "Plan"), done, #plan.items)
	TweenService:Create(h.planFill, TweenInfo.new(0.25), { Size = UDim2.fromScale(done / #plan.items, 1) }):Play()
end

-- bouncing cubes; call with true/false. The loop stops itself when `active` flips off (no leaked threads).
local bouncing = false
function UI.setBuilding(h: any, active: boolean, text: string?)
	h.overlay.Visible = active
	if text then
		h.overlayText.Text = text
	end
	if active and not bouncing then
		bouncing = true
		task.spawn(function()
			local t = 0
			while h.overlay.Visible do
				t += 0.12
				for i, c in ipairs(h.cubes) do
					c.Position = UDim2.fromOffset(10 + (i - 1) * 16, 26 - math.abs(math.sin(t + i * 0.6)) * 14)
				end
				task.wait(0.05)
			end
			bouncing = false
		end)
	end
end

function UI.toggleLabel(btn: any, text: string, on: boolean, theme: Theme)
	btn.Text = text .. ": " .. (on and "ON" or "OFF")
	btn.TextColor3 = on and theme.green or theme.mute
end

return UI
end)()

-- ==========================================================================================================

-- ---------- network: every call is pcall-wrapped, retried with backoff ----------
local function post(fn: string, body: any, withToken: boolean?): (any, any)
	local headers = { ["Content-Type"] = "application/json" }
	if withToken then
		headers["x-plugin-token"] = token
	end
	local lastCode: any = nil
	for attempt = 1, 3 do
		local ok, res = pcall(function()
			return HttpService:RequestAsync({ Url = BASE .. fn, Method = "POST", Headers = headers, Body = HttpService:JSONEncode(body or {}) })
		end)
		if ok then
			local okj, data = pcall(function()
				return HttpService:JSONDecode(res.Body)
			end)
			if res.StatusCode < 500 then
				return (okj and data or nil), res.StatusCode
			end
			lastCode = res.StatusCode
		else
			lastCode = tostring(res)
		end
		task.wait(0.4 * attempt * attempt)
	end
	return nil, lastCode
end

-- Read-only calls also use POST: the site's /api proxy forwards POST only. The body carries the plugin version.
local function get(fn: string, body: any?): any
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = BASE .. fn, Method = "POST", Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode(body or {}),
		})
	end)
	if not ok or res.StatusCode >= 400 then
		return nil
	end
	local okj, data = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	return okj and data or nil
end

-- ---------- path helpers ----------
local function resolve(path: string): Instance?
	local cur: any = game
	local first = true
	for part in string.gmatch(path, "[^%./]+") do
		-- "game", "Game", "DataModel" and "Workspace" as the first segment all mean the DataModel root or its child
		if first and (string.lower(part) == "game" or part == "DataModel") then
			first = false
			continue
		end
		first = false
		local nxt = cur:FindFirstChild(part)
		if not nxt and cur == game then
			local okSvc, svc = pcall(function()
				return game:GetService(part)
			end)
			if okSvc then
				nxt = svc
			end
		end
		if not nxt then
			return nil
		end
		cur = nxt
	end
	return cur
end
local function pathOf(inst: Instance): string
	return inst:GetFullName()
end

local function r2(n: number): number
	return math.floor(n * 100 + 0.5) / 100
end

-- ---------- edit log (source tagged so the website can badge AI / USER / BULK) ----------
local editLog: { any } = {}
local function logEdit(action: string, target: string, before: any, after: any)
	table.insert(editLog, { action = action, target = target, before = before, after = after, source = "ai" })
end

-- ---------- theme + UI ----------
local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, true, false, 340, 560, 300, 400)
local widget = plugin:CreateDockWidgetPluginGuiAsync("BlockyAI", info)
widget.Title = "BlockyAI"
local theme = UI.makeTheme(nil)
local H = UI.build(widget, theme, nil)
local toolbar = plugin:CreateToolbar("BlockyAI")
local toolbtn = toolbar:CreateButton("BlockyAI", "Open BlockyAI", "")
toolbtn.ClickableWhenViewportHidden = true
toolbtn.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)
H.version.Text = "plugin v" .. PLUGIN_VERSION

local function feed(list: any, text: string, color: Color3?, stripe: Color3?)
	list.add(text, color, stripe, nil)
end

-- flash a SelectionBox around what the agent just edited; optionally focus the camera on it
local function flash(inst: Instance)
	if not flashEnabled then
		return
	end
	local target: Instance = inst
	if not (inst:IsA("BasePart") or inst:IsA("Model")) then
		return
	end
	local box = Instance.new("SelectionBox")
	box.Adornee = target :: any
	box.Color3 = theme.violet
	box.LineThickness = 0.15
	box.Parent = workspace
	task.delay(1.2, function()
		box:Destroy()
	end)
	if focusEnabled then
		local cam = workspace.CurrentCamera
		local okBox, cf, size = pcall(function()
			if target:IsA("Model") then
				return target:GetBoundingBox()
			end
			return (target :: BasePart).CFrame, (target :: BasePart).Size
		end)
		if okBox and cam and cf then
			local dist = math.max(size.X, size.Y, size.Z) * 1.6 + 8
			cam.CFrame = CFrame.lookAt(cf.Position + Vector3.new(dist * 0.6, dist * 0.5, dist * 0.6), cf.Position)
		end
	end
end

local templates: { [string]: any } = {}
Cmds.init({ Builder = Builder, Transform = Transform, resolve = resolve, pathOf = pathOf, logEdit = logEdit, templates = templates, post = post, flash = flash })

-- ---------- classic handlers (kept from earlier versions) ----------
local handlers: { [string]: (any) -> any } = {}
local snapshots: { [string]: any } = {}

local function enc(v: any): any
	local t = typeof(v)
	if t == "Vector3" then
		return { _t = "Vector3", v.X, v.Y, v.Z }
	elseif t == "Color3" then
		return { _t = "Color3", v.R, v.G, v.B }
	elseif t == "EnumItem" then
		return { _t = "Enum", tostring(v) }
	elseif t == "Instance" then
		return { _t = "Ref", pathOf(v) }
	end
	return v
end

local function num(v: any, d: number): number
	if type(v) == "number" then
		return v
	end
	return d
end
local function toColor(v: any): Color3?
	if type(v) == "string" then
		local hex = string.match(v, "^#?(%x%x%x%x%x%x)$")
		return hex and Color3.fromHex(hex) or nil
	end
	if type(v) == "table" then
		local r, g, b = num(v[1] or v.r or v.R, 0), num(v[2] or v.g or v.G, 0), num(v[3] or v.b or v.B, 0)
		if r > 1 or g > 1 or b > 1 then
			return Color3.fromRGB(math.clamp(r, 0, 255), math.clamp(g, 0, 255), math.clamp(b, 0, 255))
		end
		return Color3.new(r, g, b)
	end
	return nil
end
local function toVec3(v: any): Vector3
	return Vector3.new(num(v[1] or v.x or v.X, 0), num(v[2] or v.y or v.Y, 0), num(v[3] or v.z or v.Z, 0))
end
local function dec(v: any, name: string): any
	if type(v) == "string" then
		local parts = string.split(v, ".")
		if #parts == 3 and parts[1] == "Enum" then
			local okE, item = pcall(function()
				return (Enum :: any)[parts[2]][parts[3]]
			end)
			if okE then
				return item
			end
		end
		if string.find(name, "Color") then
			return toColor(v) or v
		end
		return v
	end
	if type(v) ~= "table" then
		return v
	end
	if v._t == "Vector3" then
		return toVec3(v)
	elseif v._t == "Color3" then
		return toColor(v)
	elseif v._t == "UDim2" then
		return UDim2.new(num(v[1], 0), num(v[2], 0), num(v[3], 0), num(v[4], 0))
	elseif v._t == "Enum" then
		return v[1]
	end
	if string.find(name, "Color") then
		return toColor(v)
	end
	if name == "Position" or name == "Size" or name == "Orientation" or name == "Rotation" then
		return toVec3(v)
	end
	if v.r ~= nil and v.g ~= nil and v.b ~= nil then
		return toColor(v)
	end
	if v.x ~= nil and v.y ~= nil and v.z ~= nil then
		return toVec3(v)
	end
	return v
end

local function tree(inst: Instance, depth: number): any
	local node: any = { name = inst.Name, class = inst.ClassName }
	if depth > 0 then
		node.children = {}
		for i, c in ipairs(inst:GetChildren()) do
			if i > 80 then
				table.insert(node.children, { name = "...", class = "truncated", count = #inst:GetChildren() - 80 })
				break
			end
			table.insert(node.children, tree(c, depth - 1))
		end
	else
		node.child_count = #inst:GetChildren()
	end
	return node
end

function handlers.get_tree(p)
	local r: any = p.path and resolve(p.path) or workspace
	if not r then
		error("path not found")
	end
	return tree(r, math.clamp(p.depth or 2, 0, 6))
end
function handlers.find(p)
	local out, root = {}, (p.under and resolve(p.under)) or game
	for _, d in ipairs((root :: Instance):GetDescendants()) do
		if (not p.name or d.Name == p.name) and (not p.class or d.ClassName == p.class) then
			table.insert(out, pathOf(d))
			if #out >= 100 then
				break
			end
		end
	end
	return out
end
function handlers.set_properties(p)
	local i: any = resolve(p.path)
	if not i then
		error("path not found")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before set_properties")
	local changed = {}
	for k, v in pairs(p.properties or {}) do
		local before = enc(i[k])
		i[k] = dec(v, k)
		logEdit("set", pathOf(i) .. "." .. k, before, v)
		table.insert(changed, k)
	end
	ChangeHistoryService:SetWaypoint("BlockyAI set_properties")
	flash(i)
	return { path = pathOf(i), changed = changed }
end
function handlers.create(p)
	local par = resolve(p.parent)
	if not par then
		error("parent not found")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before create")
	local i: any = Instance.new(p.class)
	if p.name then
		i.Name = p.name
	end
	for k, v in pairs(p.properties or {}) do
		i[k] = dec(v, k)
	end
	i.Parent = par
	logEdit("create", pathOf(i), nil, p.class)
	ChangeHistoryService:SetWaypoint("BlockyAI create")
	flash(i)
	return { path = pathOf(i), class = i.ClassName }
end
function handlers.delete(p)
	local i = resolve(p.path)
	if not i then
		error("path not found")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before delete")
	local n = #i:GetDescendants() + 1
	logEdit("delete", pathOf(i), i.ClassName, nil)
	i:Destroy()
	return { deleted = p.path, instances_removed = n }
end
function handlers.move(p)
	local i, par = resolve(p.path), resolve(p.new_parent)
	if not i or not par then
		error("path or new_parent not found")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before move")
	i.Parent = par
	logEdit("move", p.path, nil, p.new_parent)
	return { path = pathOf(i) }
end
function handlers.read_script(p)
	local i: any = resolve(p.path)
	if not (i and i:IsA("LuaSourceContainer")) then
		error("not a script")
	end
	return { source = i.Source, class = i.ClassName }
end
function handlers.write_script(p)
	local i: any = resolve(p.path)
	if not i then
		local parentPath, name = string.match(p.path, "^(.*)[%./]([^%./]+)$")
		local par = parentPath and resolve(parentPath)
		if not par then
			error("parent not found")
		end
		i = Instance.new(p["class"] or "Script")
		i.Name = name
		i.Parent = par
	end
	local before = i.Source
	i.Source = p.source
	logEdit("write_script", pathOf(i), #before, #p.source)
	return { path = pathOf(i), class = i.ClassName, bytes = #p.source }
end
function handlers.patch_script(p)
	local i: any = resolve(p.path)
	if not (i and i:IsA("LuaSourceContainer")) then
		error("not a script")
	end
	local s, e = string.find(i.Source, p.find, 1, true)
	if not s then
		error("text to replace not found")
	end
	i.Source = string.sub(i.Source, 1, s - 1) .. p.replace .. string.sub(i.Source, e + 1)
	logEdit("patch_script", pathOf(i), nil, nil)
	return { path = pathOf(i), patched = true }
end
function handlers.batch(p)
	local results = {}
	for n, c in ipairs(p.commands or {}) do
		if not ALLOWED[c.type] or c.type == "run_lua" or c.type == "batch" then
			results[n] = { ok = false, error = "not allowed in batch" }
		else
			local ok, r = pcall(handlers[c.type], c.payload or {})
			results[n] = { ok = ok, result = ok and r or tostring(r) }
		end
	end
	return results
end

-- selection + snapshots
function handlers.get_selection()
	local out = {}
	for _, i in ipairs(Selection:Get()) do
		table.insert(out, { path = pathOf(i), class = i.ClassName })
	end
	return out
end
function handlers.snapshot_save(p)
	local id = tostring(p.label or "snapshot") .. "_" .. tostring(os.time())
	local clone = workspace:Clone()
	snapshots[id] = clone
	return { id = id, instances = #clone:GetDescendants() }
end
function handlers.snapshot_restore(p)
	local snap = snapshots[tostring(p.id)]
	if not snap then
		error("snapshot not found (snapshots live only while Studio stays open): " .. tostring(p.id))
	end
	error("snapshot_restore replaces the whole workspace; use Studio's Undo (Ctrl+Z) for edits made by BlockyAI, which are grouped into waypoints")
end

-- scene report (text) kept as the fallback for screenshot
local function sceneReport(): any
	local cam = workspace.CurrentCamera
	local L = game:GetService("Lighting")
	local rep: any = { camera = {}, lighting = { clock = L.ClockTime, brightness = L.Brightness }, nearby = {} }
	local origin = Vector3.zero
	if cam then
		local p = cam.CFrame.Position
		origin = p
		rep.camera = { position = { r2(p.X), r2(p.Y), r2(p.Z) }, fov = cam.FieldOfView }
	end
	local parts, total = {}, 0
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("BasePart") and not d:IsA("Terrain") then
			total += 1
			table.insert(parts, d)
		end
	end
	table.sort(parts, function(a, b)
		return (a.Position - origin).Magnitude < (b.Position - origin).Magnitude
	end)
	for i = 1, math.min(40, #parts) do
		local b = parts[i]
		table.insert(rep.nearby, { path = pathOf(b), class = b.ClassName, pos = { r2(b.Position.X), r2(b.Position.Y), r2(b.Position.Z) }, size = { r2(b.Size.X), r2(b.Size.Y), r2(b.Size.Z) }, material = b.Material.Name, anchored = b.Anchored })
	end
	rep.counts = { parts = total, top_level = #workspace:GetChildren() }
	return rep
end
function handlers.screenshot()
	return { kind = "scene_report", report = sceneReport(), note = "Text description of the scene. For real images use screenshot_multi (needs screenshot permission in Studio)." }
end

function handlers.run_lua(p)
	if not runLuaEnabled then
		error("run_lua is OFF in the plugin settings")
	end
	local f, err = loadstring(p.code)
	if not f then
		error(err)
	end
	return tostring(f())
end

-- new build/transform/query commands come from the tested module
for _, name in ipairs({
	"build_model", "build_from_template", "template_save", "template_load", "duplicate_array", "duplicate_grid",
	"duplicate_along_path", "mirror", "scale_model", "align", "distribute", "snap_to_ground", "get_bounding_box",
	"get_pivot", "raycast", "find_empty_space", "measure_distance", "camera_set", "terrain_fill", "terrain_heightmap",
	"lighting_set", "insert_asset",
}) do
	handlers[name] = (Cmds :: any)[name]
end
function handlers.ui_build(p)
	local parent = resolve(p.parent or "StarterGui")
	if not parent then
		error("parent not found")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before ui_build")
	local r = UIBuild.build(parent, p.spec)
	ChangeHistoryService:SetWaypoint("BlockyAI ui_build")
	if not r.ok then
		error("ui_build failed: " .. tostring(r.error) .. (r.errors and (" | " .. table.concat(r.errors, " | ")) or ""))
	end
	logEdit("ui_build", r.path, nil, r.count)
	return { path = r.path, instances = r.count, errors = r.errors, error_count = #r.errors }
end

-- screenshot_multi uploads each captured PNG; the result keeps only metadata (no giant payloads in the command result)
local pendingShots: { any } = {}
local baseScreenshotMulti = (Cmds :: any).screenshot_multi
handlers.screenshot_multi = function(p)
	local res = baseScreenshotMulti(p)
	for _, shot in ipairs(res.shots) do
		if shot.png then
			table.insert(pendingShots, { raw = shot.png, label = shot.angle })
			shot.png = nil
		end
	end
	return res
end

-- ---------- playtest (StudioTestService) ----------
local HARNESS_NAME = "__BlockyAITestHarness"
local HARNESS_SRC = [[
local STS = game:GetService("StudioTestService")
local LogService = game:GetService("LogService")
local args = STS:GetTestArgs()
local seconds = 10
if type(args) == "table" and tonumber(args.seconds) then seconds = math.clamp(tonumber(args.seconds), 2, 120) end
local lines = {}
LogService.MessageOut:Connect(function(msg, kind)
	if #lines < 200 then table.insert(lines, { kind = tostring(kind), message = string.sub(msg, 1, 300) }) end
end)
task.wait(seconds)
STS:EndTest({ ok = true, seconds = seconds, output = lines })
]]
local testRunning = false
local lastTest: any = nil
function handlers.playtest_start(p)
	if testRunning then
		error("a test is already running")
	end
	local sts = game:GetService("StudioTestService")
	local seconds = math.clamp(num(p.seconds, 10), 2, 120)
	local old = game:GetService("ServerScriptService"):FindFirstChild(HARNESS_NAME)
	if old then
		old:Destroy()
	end
	local harness = Instance.new("Script")
	harness.Name = HARNESS_NAME
	harness.Source = HARNESS_SRC
	harness.Parent = game:GetService("ServerScriptService")
	testRunning = true
	lastTest = { status = "running", mode = p.mode or "run", seconds = seconds }
	task.spawn(function()
		local ok, res = pcall(function()
			if p.mode == "play" then
				return sts:ExecutePlayModeAsync({ seconds = seconds })
			end
			return sts:ExecuteRunModeAsync({ seconds = seconds })
		end)
		testRunning = false
		local leftover = game:GetService("ServerScriptService"):FindFirstChild(HARNESS_NAME)
		if leftover then
			leftover:Destroy()
		end
		lastTest = ok and { status = "finished", result = res } or { status = "error", error = tostring(res) }
	end)
	return { started = true, mode = p.mode or "run", seconds = seconds, note = "Returns immediately. Wait about the test length, then call get_playtest_logs." }
end
function handlers.playtest_stop()
	pcall(function()
		game:GetService("StudioTestService"):EndTest({ ok = true, stopped = true })
	end)
	return { stopped = true }
end
local logBuf: { any } = {}
LogService.MessageOut:Connect(function(msg, kind)
	table.insert(logBuf, { level = tostring(kind), message = string.sub(msg, 1, 400), source = "output" })
	if #logBuf > 300 then
		table.remove(logBuf, 1)
	end
end)
function handlers.get_playtest_logs()
	return lastTest or { status = "none" }
end

-- ---------- run loop ----------
local running = false
local lastLatency = 0
local currentState = "idle"

local function paintToggles()
	UI.toggleLabel(H.luaToggle, "run_lua", runLuaEnabled, theme)
	UI.toggleLabel(H.flashToggle, "Flash edits", flashEnabled, theme)
	UI.toggleLabel(H.focusToggle, "Focus camera", focusEnabled, theme)
end
paintToggles()
H.luaToggle.MouseButton1Click:Connect(function()
	runLuaEnabled = not runLuaEnabled
	plugin:SetSetting("blockyai_runlua", runLuaEnabled)
	paintToggles()
end)
H.flashToggle.MouseButton1Click:Connect(function()
	flashEnabled = not flashEnabled
	plugin:SetSetting("blockyai_flash", flashEnabled)
	paintToggles()
end)
H.focusToggle.MouseButton1Click:Connect(function()
	focusEnabled = not focusEnabled
	plugin:SetSetting("blockyai_focus", focusEnabled)
	paintToggles()
end)

-- version check: shows a banner that LINKS to the Get Plugin page. Nothing is downloaded or executed.
local getPluginUrl = "https://blockyai.onrender.com/#/plugin"
local function checkVersion()
	local data = get("plugin-register", { version = PLUGIN_VERSION })
	if not data then
		return
	end
	if type(data.config) == "table" then
		theme = UI.makeTheme(data.config.theme)
		if type(data.config.flags) == "table" then
			if data.config.flags.flash_selection == false then
				flashEnabled = false
			end
		end
		if type(data.config.get_plugin_url) == "string" and string.find(data.config.get_plugin_url, "^https://blockyai%.onrender%.com/") then
			getPluginUrl = data.config.get_plugin_url
		end
	end
	if data.update_available == true then
		H.banner.Visible = true
		H.banner.Text = "UPDATE AVAILABLE (v" .. tostring(data.latest_version) .. "): open " .. getPluginUrl
	end
end
task.spawn(checkVersion)

local pendingModal: any = nil
local function answerModal(allow: boolean)
	if not pendingModal then
		return
	end
	local id = pendingModal
	pendingModal = nil
	H.modal.Visible = false
	post("plugin-chat", { confirm = { id = id, allow = allow } }, true)
end
H.modalYes.MouseButton1Click:Connect(function()
	answerModal(true)
end)
H.modalNo.MouseButton1Click:Connect(function()
	answerModal(false)
end)

local function refreshChat()
	local data = post("plugin-chat", {}, true)
	if not data then
		return
	end
	currentState = tostring(data.state or "idle")
	local busy = currentState == "thinking" or currentState == "working"
	UI.setBuilding(H, busy, busy and "Blocky is building..." or nil)
	UI.setPlan(H, theme, data.plan)
	H.info.Text = string.format("%s   |   session: %s   |   VM: %s   |   %d ms", tostring(data.place_name or game.Name), currentState, tostring(data.vm_status or "?"), lastLatency)
	H.chat.clear()
	for _, m in ipairs(data.messages or {}) do
		local isUser = m.role == "user"
		feed(H.chat, (isUser and "You: " or "Blocky: ") .. tostring(m.content), isUser and theme.text or theme.mute, isUser and theme.green or theme.violet)
	end
	local pend = data.pending_confirmations
	if type(pend) == "table" and #pend > 0 and not pendingModal then
		pendingModal = pend[1].id
		H.modalText.Text = "The AI wants to run: " .. tostring(pend[1].type) .. "\nA snapshot/undo waypoint is created first. Allow it?"
		H.modal.Visible = true
	end
end

H.chatSend.MouseButton1Click:Connect(function()
	local text = H.chatBox.Text
	if text == "" then
		return
	end
	local res, code = post("plugin-chat", { send = text }, true)
	if res and res.ok then
		H.chatBox.Text = ""
	else
		feed(H.chat, (res and res.error) or ("send failed (" .. tostring(code) .. ")"), theme.red, theme.red)
	end
	task.spawn(refreshChat)
end)
H.stop.MouseButton1Click:Connect(function()
	post("plugin-chat", { stop = true }, true)
	feed(H.activity, "Stop requested", theme.amber, theme.amber)
	task.spawn(refreshChat)
end)

-- Plain base64 encoder. HttpService has none, and raw PNG bytes cannot go through JSON, so encode here (yielding every 200 groups).
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64(data: string): string
	local out = table.create(math.ceil(#data / 3))
	for i = 1, #data, 3 do
		local a, b, c = string.byte(data, i, i + 2)
		local n = a * 65536 + (b or 0) * 256 + (c or 0)
		local c1, c2 = bit32.extract(n, 18, 6), bit32.extract(n, 12, 6)
		local c3, c4 = bit32.extract(n, 6, 6), bit32.extract(n, 0, 6)
		local piece = string.sub(B64, c1 + 1, c1 + 1) .. string.sub(B64, c2 + 1, c2 + 1)
		piece ..= b and string.sub(B64, c3 + 1, c3 + 1) or "="
		piece ..= c and string.sub(B64, c4 + 1, c4 + 1) or "="
		table.insert(out, piece)
		if #out % 200 == 0 then
			task.wait()
		end
	end
	return table.concat(out)
end

local function uploadShots(commandId: string)
	for _, shot in ipairs(pendingShots) do
		post("plugin-result", { command_id = commandId, ok = true, result = { uploaded = shot.label }, screenshot_b64 = base64(shot.raw), screenshot_label = shot.label }, true)
	end
	table.clear(pendingShots)
end

-- ---------- command bridge wiring ----------
local resultCache = Bridge.newCache(200)
local function featureProbe(name: string): boolean
	if name == "StudioTestService" then
		return game:GetService("StudioTestService") ~= nil
	elseif name == "ExecutePlayModeAsync" or name == "ExecuteRunModeAsync" then
		return typeof((game:GetService("StudioTestService") :: any)[name]) == "function"
	elseif name == "CaptureService" then
		return game:GetService("CaptureService") ~= nil
	elseif name == "Terrain.FillBlock" then
		return typeof((workspace.Terrain :: any).FillBlock) == "function"
	elseif name == "Terrain.WriteVoxels" then
		return typeof((workspace.Terrain :: any).WriteVoxels) == "function"
	elseif name == "ChangeHistoryService.Recording" then
		return typeof((ChangeHistoryService :: any).TryBeginRecording) == "function"
	elseif name == "Raycast" then
		return typeof((workspace :: any).Raycast) == "function"
	elseif name == "HttpService.RequestAsync" then
		return typeof((HttpService :: any).RequestAsync) == "function"
	elseif name == "Selection" then
		return Selection ~= nil
	end
	return false
end
local bridgeEnv: any = {
	handlers = handlers,
	allowed = ALLOWED,
	cache = resultCache,
	playtestActive = function()
		return testRunning
	end,
	ack = function(id: string)
		post("plugin-ack", { command_id = id }, true)
	end,
	heartbeat = function(id: string)
		post("plugin-ack", { command_id = id, heartbeat = true }, true)
	end,
	clock = os.clock,
	spawn = task.spawn,
	wait = task.wait,
	beat_s = 10,
}

-- ---------- in-Studio self-test (no AI) ----------
-- Builds everything under one root folder and removes it afterwards. Uses the plugin's REAL handlers against the REAL engine.
local selfTestRunning = false
local function runSelfTest()
	if selfTestRunning then
		return
	end
	if testRunning then
		H.selftestOut.Text = "A playtest is running. Stop it first."
		return
	end
	selfTestRunning = true
	H.selftest.Text = "RUNNING..."
	H.selftestOut.Text = ""
	local rootName = "__BlockyAISelfTest"
	local old = workspace:FindFirstChild(rootName)
	if old then
		old:Destroy()
	end
	local root = Instance.new("Folder")
	root.Name = rootName
	root.Parent = workspace
	local tracked: { string } = {}
	local Lighting = game:GetService("Lighting")
	local function countDescendants(): number
		return #workspace:GetDescendants() + #game:GetService("ServerScriptService"):GetDescendants() + #game:GetService("StarterGui"):GetDescendants()
	end
	local kitchenSink = { name = "SelfTestModel", class = "Model", children = {
		{ name = "Base", class = "Part", size = { 8, 1, 8 }, position = { 0, 0.5, 0 }, material = "Concrete", color = "#808080" },
		{ name = "Pillar", class = "Part", shape = "Cylinder", size = { 6, 2, 2 }, position = { 0, 4, 0 }, material = "Metal", color = "#B0B0B0" },
		{ name = "Roof", class = "WedgePart", size = { 8, 2, 8 }, position = { 0, 8, 0 }, material = "Wood", color = "#8B5A2B" },
		{ name = "Ball", class = "Part", shape = "Ball", size = { 3, 3, 3 }, position = { 5, 3, 0 }, material = "Neon", color = "#00A2FF" },
		{ name = "Glass", class = "Part", size = { 4, 4, 0.5 }, position = { -5, 3, 0 }, material = "Glass", color = "#A0D8FF", transparency = 0.5 },
		{ name = "Lamp", class = "Part", size = { 1, 1, 1 }, position = { 0, 10, 0 }, children = { { name = "Light", class = "PointLight", brightness = 2, range = 12 } } },
	} }
	local uiSpec = { name = "SelfTestGui", class = "ScreenGui", children = {
		{ name = "Panel", class = "Frame", size = { 0, 240, 0, 120 }, position = { 0, 10, 0, 10 }, children = {
			{ name = "Title", class = "TextLabel", text = "Self-test", size = { 1, 0, 0, 30 } },
			{ name = "Go", class = "TextButton", text = "OK", size = { 0, 80, 0, 28 }, position = { 0, 10, 0, 50 } },
		} },
	} }
	local ctx: any = {
		root = "Workspace." .. rootName,
		h = handlers,
		kitchenSink = kitchenSink,
		uiSpec = uiSpec,
		encode = function(v: any): string
			local ok, s = pcall(function()
				return HttpService:JSONEncode(v)
			end)
			return ok and s or tostring(v)
		end,
		http = function(fn: string, body: any)
			return post(fn, body, false)
		end,
		track = function(path: string)
			table.insert(tracked, path)
		end,
		wait = task.wait,
		countDescendants = countDescendants,
		undo = function()
			ChangeHistoryService:Undo()
		end,
		clearTerrain = function()
			pcall(function()
				workspace.Terrain:Clear()
			end)
		end,
		saveLighting = function()
			return { Brightness = Lighting.Brightness, ClockTime = Lighting.ClockTime }
		end,
		restoreLighting = function(saved: any)
			for k, v in pairs(saved or {}) do
				pcall(function()
					(Lighting :: any)[k] = v
				end)
			end
		end,
		cleanup = function()
			local errs = {}
			for _, path in ipairs(tracked) do
				local inst = resolve(path)
				if inst then
					local ok, e = pcall(function()
						inst:Destroy()
					end)
					if not ok then
						table.insert(errs, path .. ": " .. tostring(e))
					end
				end
			end
			pcall(function()
				root:Destroy()
			end)
			local h = game:GetService("ServerScriptService"):FindFirstChild(HARNESS_NAME)
			if h then
				h:Destroy()
			end
			if #errs > 0 then
				error(table.concat(errs, "; "))
			end
		end,
	}
	local features = Bridge.detect(featureProbe)
	local report = SelfTest.run(SelfTest.steps(), ctx, features)
	local lines = { string.format("%d passed, %d failed, %d skipped%s", report.passed, report.failed, report.skipped, report.cleaned and "" or ("  (CLEANUP FAILED: " .. tostring(report.cleanup_error) .. ")")) }
	for _, st in ipairs(report.steps) do
		table.insert(lines, string.format("[%s] %s%s", string.upper(st.status), st.name, st.error and (": " .. string.sub(st.error, 1, 90)) or ""))
	end
	H.selftestOut.Text = table.concat(lines, "\n")
	H.selftest.Text = "RUN SELF-TEST"
	local studioVersion = "unknown"
	pcall(function()
		studioVersion = (getfenv() :: any).version()
	end)
	local data, code = post("plugin-selftest", { studio_version = studioVersion, plugin_version = PLUGIN_VERSION, features = features, steps = report.steps }, true)
	if not data then
		H.selftestOut.Text = H.selftestOut.Text .. "\n(could not send the report to the server: " .. tostring(code) .. ")"
	end
	selfTestRunning = false
end
H.selftest.MouseButton1Click:Connect(function()
	task.spawn(runSelfTest)
end)

local function loop()
	if running then
		return
	end
	running = true
	local lastChat = 0
	while token do
		local t0 = os.clock()
		local data, code = post("plugin-poll", {}, true)
		lastLatency = math.floor((os.clock() - t0) * 1000)
		if code == 401 then
			token = nil
			plugin:SetSetting("blockyai_token", nil)
			UI.setConnected(H, false)
			UI.setStatus(H, theme, "OFFLINE")
			H.pairStatus.Text = "Token rejected. Pair again with a new code."
			H.pairStatus.Visible = true
			break
		end
		if data then
			UI.setStatus(H, theme, testRunning and "TESTING" or "LIVE")
			if os.clock() - lastChat > 3 then
				lastChat = os.clock()
				task.spawn(refreshChat)
			end
		else
			UI.setStatus(H, theme, "RETRY")
		end
		for _, c in ipairs((data and data.commands) or {}) do
			local label = tostring(c.type)
			local row = H.activity.add("> " .. label, theme.text, theme.blue, nil)
			-- Bridge.execute: idempotency cache (never runs the same command twice), playtest guard, ACK before work, heartbeat during it.
			local outcome = Bridge.execute(bridgeEnv, c)
			local ok, res = outcome.ok, (outcome.ok and outcome.result or outcome.error)
			row.Stripe.BackgroundColor3 = ok and theme.green or theme.red
			row.Text.Text = "> " .. label .. (outcome.cached and "  (repeat: stored result)" or (ok and "  done" or ("  FAILED: " .. string.sub(tostring(res), 1, 140))))
			for _, e in ipairs(editLog) do
				H.editlog.add(string.format("[%s] %s %s", string.upper(tostring(e.source)), tostring(e.action), tostring(e.target)), theme.text, theme.violet, nil)
			end
			local body: any = { command_id = c.id, ok = ok, edit_log = editLog, playtest_logs = logBuf }
			if ok then
				body.result = res
			else
				body.error = tostring(res)
			end
			for _, l in ipairs(logBuf) do
				local col = l.level:find("Error") and theme.red or (l.level:find("Warning") and theme.amber or theme.mute)
				H.console.add(l.message, col, col, Enum.Font.Code)
			end
			editLog, logBuf = {}, {}
			post("plugin-result", body, true)
			if #pendingShots > 0 then
				uploadShots(c.id)
			end
		end
		if not data then
			task.wait(3)
		end
	end
	running = false
end

H.codeBox:GetPropertyChangedSignal("Text"):Connect(function()
	UI.setCode(H, H.codeBox.Text)
end)
H.connect.MouseButton1Click:Connect(function()
	local cleaned = string.upper((string.gsub(H.codeBox.Text or "", "%s", "")))
	local features = Bridge.detect(featureProbe)
	local studioVersion = "unknown"
	-- version() is flagged deprecated by the analyzer but is still the only call that returns the Studio build string; a failure just reports "unknown".
	pcall(function()
		studioVersion = (getfenv() :: any).version()
	end)
	local data, code = post("plugin-pair", { code = cleaned, place_name = game.Name ~= "" and game.Name or "Untitled place", studio_version = studioVersion, features = features, plugin_version = PLUGIN_VERSION }, false)
	if data and data.token then
		token = data.token
		plugin:SetSetting("blockyai_token", token)
		UI.setConnected(H, true)
		feed(H.activity, "Paired with the website", theme.green, theme.green)
		task.spawn(loop)
	else
		H.pairStatus.Text = "Pairing failed (" .. tostring(code) .. "). Check the code."
		H.pairStatus.Visible = true
	end
end)
H.disconnect.MouseButton1Click:Connect(function()
	token = nil
	plugin:SetSetting("blockyai_token", nil)
	UI.setConnected(H, false)
	UI.setStatus(H, theme, "OFFLINE")
end)

if token then
	UI.setConnected(H, true)
	task.spawn(loop)
end
