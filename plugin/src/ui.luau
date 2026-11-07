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
