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
