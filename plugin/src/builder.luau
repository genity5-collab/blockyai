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
	cancelled: boolean?,
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
		cancelFn = o.cancelled,
		isCancelled = false,
	}, Ctx)
end

function Ctx:note(inst: any, label: string)
	self.count += 1
	self.byClass[inst.ClassName] = (self.byClass[inst.ClassName] or 0) + 1
	if self.count % YIELD_EVERY == 0 then
		self.yield()
	end
end

-- Cooperative cancel: the bridge's cancelled() turns true after the user pressed Stop. Checked before every node, sticky once set.
-- A callback that errors is ignored (a broken flag must never break a build).
function Ctx:stopped(): boolean
	if self.isCancelled then
		return true
	end
	if self.cancelFn then
		local ok, v = pcall(self.cancelFn)
		if ok and v == true then
			self.isCancelled = true
		end
	end
	return self.isCancelled
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
	if ctx:stopped() then
		return nil
	end
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
			if ctx:stopped() then
				break
			end
			Builder.buildNode(ctx, child, inst, origin, label)
		end
	end
	-- Cancelled while building this subtree: throw the half-built (still unparented) instance away instead of publishing it.
	if ctx.isCancelled then
		pcall(function()
			inst:Destroy()
		end)
		return nil
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
	if ctx.isCancelled then
		return { ok = false, cancelled = true, error = "cancelled: you pressed Stop, so the build was abandoned and nothing from it was added to the game", count = ctx.count, errors = ctx.errors }
	end
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
