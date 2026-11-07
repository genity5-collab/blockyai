-- A tiny Roblox engine mock: real vector/CFrame math, Instance tree, Enum items. Enough to run the builder for real.
local M = {}

local Vector3 = {}
Vector3.__index = Vector3
function Vector3.new(x: number?, y: number?, z: number?)
	return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3)
end
Vector3.zero = Vector3.new(0, 0, 0)
Vector3.one = Vector3.new(1, 1, 1)
Vector3.__add = function(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
Vector3.__sub = function(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
Vector3.__mul = function(a, b)
	if type(b) == "number" then return Vector3.new(a.X * b, a.Y * b, a.Z * b) end
	if type(a) == "number" then return Vector3.new(b.X * a, b.Y * a, b.Z * a) end
	return Vector3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
Vector3.__div = function(a, b) return Vector3.new(a.X / b, a.Y / b, a.Z / b) end
Vector3.__tostring = function(a) return string.format("%g, %g, %g", a.X, a.Y, a.Z) end
Vector3.__eq = function(a, b) return a.X == b.X and a.Y == b.Y and a.Z == b.Z end
function Vector3.Lerp(a, b, t) return Vector3.new(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t) end
Vector3.__index = function(t, k)
	if k == "Magnitude" then return math.sqrt(t.X * t.X + t.Y * t.Y + t.Z * t.Z) end
	return rawget(Vector3, k)
end

-- CFrame as position + 3x3 rotation (row-major r11..r33)
local CFrame = {}
CFrame.__index = CFrame
local function cf(p, r) return setmetatable({ Position = p, R = r }, CFrame) end
local ID = { 1, 0, 0, 0, 1, 0, 0, 0, 1 }
function CFrame.new(...)
	local n = select("#", ...)
	local a = { ... }
	if n == 0 then return cf(Vector3.zero, ID) end
	if n == 1 then return cf(a[1], ID) end
	if n == 3 then return cf(Vector3.new(a[1], a[2], a[3]), ID) end
	if n == 12 then return cf(Vector3.new(a[1], a[2], a[3]), { a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12] }) end
	error("CFrame.new: unsupported arg count " .. n)
end
local function mulR(A, B)
	local R = {}
	for i = 0, 2 do for j = 0, 2 do
		R[i * 3 + j + 1] = A[i * 3 + 1] * B[j + 1] + A[i * 3 + 2] * B[3 + j + 1] + A[i * 3 + 3] * B[6 + j + 1]
	end end
	return R
end
local function rotV(R, v) return Vector3.new(R[1] * v.X + R[2] * v.Y + R[3] * v.Z, R[4] * v.X + R[5] * v.Y + R[6] * v.Z, R[7] * v.X + R[8] * v.Y + R[9] * v.Z) end
function CFrame.Angles(rx, ry, rz)
	-- Roblox order: Rz * Ry * Rx applied as CFrame.Angles(rx,ry,rz) = Rx * Ry * Rz
	local cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
	local Rx = { 1, 0, 0, 0, cx, -sx, 0, sx, cx }
	local Ry = { cy, 0, sy, 0, 1, 0, -sy, 0, cy }
	local Rz = { cz, -sz, 0, sz, cz, 0, 0, 0, 1 }
	return cf(Vector3.zero, mulR(mulR(Rx, Ry), Rz))
end
CFrame.__mul = function(a, b)
	if getmetatable(b) == Vector3 then return a.Position + rotV(a.R, b) end
	return cf(a.Position + rotV(a.R, b.Position), mulR(a.R, b.R))
end
CFrame.__index = function(t, k)
	if k == "X" then return t.Position.X elseif k == "Y" then return t.Position.Y elseif k == "Z" then return t.Position.Z end
	return rawget(CFrame, k)
end
CFrame.__add = function(a, v) return cf(a.Position + v, a.R) end
CFrame.__sub = function(a, v) return cf(a.Position - v, a.R) end
function CFrame.GetComponents(c) return c.Position.X, c.Position.Y, c.Position.Z, table.unpack(c.R) end

local Color3 = {}
Color3.__index = Color3
function Color3.new(r, g, b) return setmetatable({ R = r, G = g, B = b }, Color3) end
function Color3.Lerp(a, b, t) return Color3.new(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t) end
function Color3.fromRGB(r, g, b) return Color3.new(r / 255, g / 255, b / 255) end
function Color3.fromHex(h) return Color3.fromRGB(tonumber(h:sub(1, 2), 16), tonumber(h:sub(3, 4), 16), tonumber(h:sub(5, 6), 16)) end

local function enumTable(name, items)
	local t = {}
	for _, i in ipairs(items) do t[i] = setmetatable({ Name = i, EnumType = name }, { __tostring = function() return "Enum." .. name .. "." .. i end }) end
	return t
end
local Enum = {
	Material = enumTable("Material", { "Plastic", "SmoothPlastic", "Wood", "Metal", "Glass", "Neon", "Concrete", "Grass", "Brick", "Slate", "Fabric", "Cobblestone", "Granite", "Marble", "Sand", "Ice", "Rubber", "Foil", "Pebble", "WoodPlanks", "DiamondPlate", "CorrodedMetal", "Asphalt", "Cardboard" }),
	PartType = enumTable("PartType", { "Block", "Ball", "Cylinder" }),
	NormalId = enumTable("NormalId", { "Top", "Front", "Back" }),
	MeshType = enumTable("MeshType", { "Brick", "Sphere", "FileMesh" }),
}

-- Instance: class hierarchy for IsA, Parent/Children, attributes, read-only property guard
local GUI = { ScreenGui = 1, Frame = 1, TextLabel = 1, TextButton = 1, TextBox = 1, ImageLabel = 1, ImageButton = 1, ScrollingFrame = 1 }
local GUIOBJ = { Frame = 1, TextLabel = 1, TextButton = 1, TextBox = 1, ImageLabel = 1, ImageButton = 1, ScrollingFrame = 1 }
local BASEPART = { Part = 1, WedgePart = 1, CornerWedgePart = 1, TrussPart = 1, MeshPart = 1, Seat = 1, VehicleSeat = 1, SpawnLocation = 1 }
local KNOWN = { UIListLayout = 1, UIGridLayout = 1, UICorner = 1, UIStroke = 1, UIPadding = 1, UIAspectRatioConstraint = 1, UIGradient = 1, ScreenGui = 1, ScrollingFrame = 1, TextButton = 1, TextBox = 1, ImageLabel = 1, ImageButton = 1, Model = 1, Folder = 1, Script = 1, LocalScript = 1, ModuleScript = 1, WeldConstraint = 1, Motor6D = 1, HingeConstraint = 1, PointLight = 1, SpotLight = 1, SurfaceLight = 1, ParticleEmitter = 1, Sound = 1, Attachment = 1, Decal = 1, Texture = 1, SurfaceGui = 1, SpecialMesh = 1, ProximityPrompt = 1, ClickDetector = 1, UnionOperation = 1, BillboardGui = 1, TextLabel = 1, Frame = 1, BoolValue = 1, IntValue = 1, NumberValue = 1, StringValue = 1, ObjectValue = 1 }
for k in pairs(BASEPART) do KNOWN[k] = 1 end
local Inst = {}
Inst.__index = function(t, k)
	local m = rawget(Inst, k)
	if m ~= nil then return m end
	local p = rawget(t, "_p")
	if k == "Position" and p.CFrame then return p.CFrame.Position end
	if p[k] == nil and type(k) == "string" and (string.find(k, "^Mouse") or string.find(k, "^Focus") or k == "Activated" or k == "Changed") then return { Connect = function() return {} end } end
	if p[k] == nil and k == "Name" then return p.ClassName end
	if p[k] == nil then
		-- named children are reachable as properties (row.Stripe), like Roblox
		for _, c in ipairs(t._children) do if c.Name == k then return c end end
	end
	return p[k]
end
Inst.__newindex = function(t, k, v)
	local p = rawget(t, "_p")
	if k == "Parent" then
		local old = p.Parent
		if old then for i, c in ipairs(old._children) do if c == t then table.remove(old._children, i) break end end end
		p.Parent = v
		if v then table.insert(v._children, t) end
		return
	end
	if k == "Position" and p.CFrame then p.CFrame = CFrame.new(v) return end
	if k == "Size" and BASEPART[p.ClassName] and p.ClassName == "TrussPart" then error("TrussPart.Size is restricted") end
	if k == "MeshId" then error("MeshId is read-only for plugins") end
	if p.__strict and p[k] == nil and k ~= "PrimaryPart" and k ~= "PivotOffset" and k ~= "Enabled" then error(k .. " is not a valid member of " .. p.ClassName) end
	p[k] = v
end
function Inst:IsA(c)
	local cn = rawget(self, "_p").ClassName
	if c == "GuiObject" then return GUIOBJ[cn] ~= nil end
	return cn == c or (c == "BasePart" and BASEPART[cn] ~= nil) or c == "Instance"
end
function Inst:GetChildren() local r = {} for _, c in ipairs(self._children) do r[#r + 1] = c end return r end
function Inst:GetDescendants()
	local r = {}
	local function walk(n) for _, c in ipairs(n._children) do r[#r + 1] = c walk(c) end end
	walk(self)
	return r
end
function Inst:GetFullName()
	local parts, n = {}, self
	while n do table.insert(parts, 1, n.Name) n = rawget(n, "_p").Parent end
	return table.concat(parts, ".")
end
function Inst:SetAttribute(k, v) self._attrs[k] = v end
function Inst:GetAttribute(k) return self._attrs[k] end
function Inst:FindFirstChild(n) for _, c in ipairs(self._children) do if c.Name == n then return c end end end
function Inst:Destroy() self.Parent = nil end
function Inst:GetPivot()
	local p = rawget(self, "_p")
	if p.CFrame then return p.CFrame end
	-- model pivot = center of first part found
	for _, d in ipairs(self:GetDescendants()) do if rawget(d, "_p").CFrame then return rawget(d, "_p").CFrame end end
	error("no pivot")
end
function Inst:Clone()
	local p = rawget(self, "_p")
	local c = M._new(p.ClassName)
	local cp = rawget(c, "_p")
	for k, v in pairs(p) do if k ~= "Parent" and k ~= "ClassName" then cp[k] = v end end
	for k, v in pairs(self._attrs) do c._attrs[k] = v end
	for _, ch in ipairs(self._children) do local cc = ch:Clone(); cc.Parent = c end
	return c
end

local created = 0
local function newInstance(class)
	if not KNOWN[class] then error("Unable to create an Instance of type \"" .. tostring(class) .. "\"") end
	created += 1
	local p = { ClassName = class, Name = class, Parent = nil }
	if BASEPART[class] then
		p.Size = Vector3.new(4, 1, 2); p.CFrame = CFrame.new(); p.Anchored = false; p.CanCollide = true
		p.Color = Color3.new(0.63, 0.63, 0.63); p.Transparency = 0; p.Reflectance = 0; p.CastShadow = true
		p.Material = Enum.Material.Plastic; p.Shape = Enum.PartType.Block
	end
	if class == "WeldConstraint" then p.Part0 = nil; p.Part1 = nil end
	if class == "PointLight" then p.Brightness = 1; p.Range = 8; p.Color = Color3.new(1, 1, 1) end
	if class == "ProximityPrompt" then p.ActionText = "Interact"; p.ObjectText = ""; p.MaxActivationDistance = 10 end
	if GUIOBJ[class] then p.Size = nil; p.Position = nil; p.BackgroundTransparency = 0; p.Visible = true end
	local self = setmetatable({ _p = p, _children = {}, _attrs = {} }, Inst)
	if class == "Script" or class == "LocalScript" or class == "ModuleScript" then p.Source = "" end
	if class == "Model" then p.PrimaryPart = nil end
	return self
end

local UDim2 = {}
UDim2.__index = UDim2
function UDim2.new(sx, ox, sy, oy) return setmetatable({ X = { Scale = sx or 0, Offset = ox or 0 }, Y = { Scale = sy or 0, Offset = oy or 0 } }, UDim2) end
function UDim2.fromOffset(x, y) return UDim2.new(0, x, 0, y) end
function UDim2.fromScale(x, y) return UDim2.new(x, 0, y, 0) end
local UDim = { new = function(s, o) return { Scale = s, Offset = o } end }
local Vector2 = { new = function(x, y) return { X = x, Y = y } end }
Enum.Font = enumTable("Font", { "GothamBold", "Gotham", "Code", "FredokaOne" })
Enum.FillDirection = enumTable("FillDirection", { "Vertical", "Horizontal" })
Enum.SortOrder = enumTable("SortOrder", { "LayoutOrder" })
Enum.EasingStyle = enumTable("EasingStyle", { "Quad" })
Enum.ApplyStrokeMode = enumTable("ApplyStrokeMode", { "Border" })
Enum.AutomaticSize = enumTable("AutomaticSize", { "Y" })
Enum.TextXAlignment = enumTable("TextXAlignment", { "Left" })
Enum.TextYAlignment = enumTable("TextYAlignment", { "Top" })
Enum.Font.Gotham = Enum.Font.Gotham
local ColorSequence = { new = function(a, b) return { a, b } end }
local TweenInfo = { new = function() return {} end }
KNOWN.UIGradient = 1
local fakeSignal = function() return { Connect = function() return {} end } end
M._signal = fakeSignal
M._new = newInstance
M.install = function(env)
	env.ColorSequence = ColorSequence; env.TweenInfo = TweenInfo; env.UDim2 = UDim2; env.UDim = UDim; env.Vector2 = Vector2; env.Vector3 = Vector3; env.CFrame = CFrame; env.Color3 = Color3; env.Enum = Enum
	env.Instance = { new = newInstance }
	env.typeof = function(v)
		local mt = getmetatable(v)
		if mt == Vector3 then return "Vector3" elseif mt == CFrame then return "CFrame" elseif mt == Color3 then return "Color3" elseif mt == Inst then return "Instance" end
		for _, tbl in pairs(Enum) do for _, item in pairs(tbl) do if item == v then return "EnumItem" end end end
		return type(v)
	end
	env.game = { GetService = function() return { AddTag = function() end } end }
	env.workspace = newInstance("Model"); env.workspace.Name = "Workspace"
end
M.created = function() return created end
return M
