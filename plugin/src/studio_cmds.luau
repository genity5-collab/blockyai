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
