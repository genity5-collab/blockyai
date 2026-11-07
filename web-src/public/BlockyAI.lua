-- BlockyAI Studio plugin. Paste into a Script, right-click it, Save as Local Plugin. Enable Allow HTTP Requests in Game Settings.
-- Talks ONLY to blockyai.onrender.com with a per-session token. No API keys or backend addresses live here.
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local LogService = game:GetService("LogService")

local BASE = "https://blockyai.onrender.com/api/"
local token = plugin:GetSetting("blockyai_token")
local runLuaEnabled = plugin:GetSetting("blockyai_runlua") == true

local ALLOWED = {
	get_tree = true, find = true, set_properties = true, create = true, delete = true, move = true,
	read_script = true, write_script = true, patch_script = true, batch = true,
	playtest_start = true, playtest_stop = true, get_playtest_logs = true, screenshot = true,
	snapshot_save = true, snapshot_restore = true, get_selection = true, run_lua = true,
}

local function post(fn, body, withToken)
	local headers = { ["Content-Type"] = "application/json" }
	if withToken then
		headers["x-plugin-token"] = token
	end
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = BASE .. fn,
			Method = "POST",
			Headers = headers,
			Body = HttpService:JSONEncode(body or {}),
		})
	end)
	if not ok then
		return nil, tostring(res)
	end
	local okj, data = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	if okj then
		return data, res.StatusCode
	end
	return nil, res.StatusCode
end

-- ---------- path helpers ----------
local function resolve(path)
	local cur = game
	for part in string.gmatch(path, "[^%./]+") do
		if not (cur == game and part == "game") then
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
	end
	return cur
end

local function pathOf(inst)
	return inst:GetFullName()
end

-- Turn a few Roblox value types into JSON-friendly tables and back.
local function enc(v)
	local t = typeof(v)
	if t == "Vector3" then
		return { _t = "Vector3", v.X, v.Y, v.Z }
	elseif t == "Color3" then
		return { _t = "Color3", v.R, v.G, v.B }
	elseif t == "UDim2" then
		return { _t = "UDim2", v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset }
	elseif t == "EnumItem" then
		return { _t = "Enum", tostring(v) }
	elseif t == "CFrame" then
		return { _t = "CFrame", v:GetComponents() }
	elseif t == "Instance" then
		return { _t = "Ref", pathOf(v) }
	end
	return v
end

-- Accepts every shape the AI is likely to write:
--   {_t="Color3",r,g,b}  {r=,g=,b=}  {R=,G=,B=}  "#RRGGBB"  [r,g,b] (0-1 or 0-255)
--   {_t="Vector3",x,y,z} {x=,y=,z=}  {X=,Y=,Z=}  [x,y,z]
--   {_t="UDim2",...}  {_t="CFrame",...}  {_t="Enum","Enum.Material.Neon"}  "Enum.Material.Neon"
local function num(v, d)
	if type(v) == "number" then
		return v
	end
	return d or 0
end

local function pick(v, a, b, c)
	if v[a] ~= nil then
		return v[a]
	end
	if v[b] ~= nil then
		return v[b]
	end
	return v[c]
end

local function toColor(v)
	if type(v) == "string" then
		local hex = string.match(v, "^#?(%x%x%x%x%x%x)$")
		if hex then
			return Color3.fromHex(hex)
		end
		return nil
	end
	local r = num(pick(v, "r", "R", 1))
	local g = num(pick(v, "g", "G", 2))
	local b = num(pick(v, "b", "B", 3))
	if r > 1 or g > 1 or b > 1 then
		return Color3.fromRGB(math.clamp(r, 0, 255), math.clamp(g, 0, 255), math.clamp(b, 0, 255))
	end
	return Color3.new(r, g, b)
end

local function toVec3(v)
	return Vector3.new(num(pick(v, "x", "X", 1)), num(pick(v, "y", "Y", 2)), num(pick(v, "z", "Z", 3)))
end

local function toEnum(str)
	local parts = string.split(str, ".")
	if #parts == 3 and parts[1] == "Enum" then
		local okE, item = pcall(function()
			return Enum[parts[2]][parts[3]]
		end)
		if okE then
			return item
		end
	end
	return nil
end

-- name is the property being set, so a bare table can be interpreted by what it must be.
local function dec(v, name)
	if type(v) == "string" then
		local e = toEnum(v)
		if e ~= nil then
			return e
		end
		if name == "Color" or name == "BackgroundColor3" or name == "TextColor3" or name == "Color3" then
			local c = toColor(v)
			if c then
				return c
			end
		end
		return v
	end
	if type(v) ~= "table" then
		return v
	end
	local t = v._t
	if t == "Vector3" then
		return toVec3(v)
	elseif t == "Color3" then
		return toColor(v)
	elseif t == "UDim2" then
		return UDim2.new(num(v[1]), num(v[2]), num(v[3]), num(v[4]))
	elseif t == "CFrame" then
		return CFrame.new(table.unpack(v))
	elseif t == "Enum" then
		return toEnum(v[1]) or v[1]
	end
	-- untagged table: decide by the property name, then by the keys present
	local colorProp = name == "Color" or name == "BackgroundColor3" or name == "TextColor3" or name == "Color3" or name == "BorderColor3"
	if colorProp then
		return toColor(v)
	end
	if name == "Position" or name == "Size" or name == "Orientation" or name == "Rotation" or name == "Velocity" or name == "CanvasSize" then
		if v.x ~= nil or v.X ~= nil or v[1] ~= nil then
			return toVec3(v)
		end
	end
	if (v.r ~= nil and v.g ~= nil and v.b ~= nil) or (v.R ~= nil and v.G ~= nil and v.B ~= nil) then
		return toColor(v)
	end
	if v.x ~= nil and v.y ~= nil and v.z ~= nil then
		return toVec3(v)
	end
	return v
end

local editLog = {}
local function logEdit(action, target, before, after)
	table.insert(editLog, { action = action, target = target, before = before, after = after })
end

local function tree(inst, depth)
	local node = { name = inst.Name, class = inst.ClassName }
	if depth > 0 then
		node.children = {}
		for _, c in ipairs(inst:GetChildren()) do
			if #node.children < 200 then
				table.insert(node.children, tree(c, depth - 1))
			end
		end
	end
	return node
end

local snapshots = {}
local handlers = {}

function handlers.get_tree(p)
	local r = workspace
	if p.path then
		r = resolve(p.path)
	end
	if not r then
		error("path not found")
	end
	return tree(r, math.clamp(p.depth or 2, 0, 6))
end

function handlers.find(p)
	local out = {}
	local root = game
	if p.under then
		root = resolve(p.under) or game
	end
	for _, d in ipairs(root:GetDescendants()) do
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
	local i = resolve(p.path)
	if not i then
		error("path not found")
	end
	ChangeHistoryService:SetWaypoint("BlockyAI before set_properties")
	for k, v in pairs(p.properties or {}) do
		local before = enc(i[k])
		i[k] = dec(v, k)
		logEdit("set", pathOf(i) .. "." .. k, before, v)
	end
	ChangeHistoryService:SetWaypoint("BlockyAI set_properties")
	return "ok"
end

function handlers.create(p)
	local par = resolve(p.parent)
	if not par then
		error("parent not found")
	end
	local i = Instance.new(p["class"])
	if p.name then
		i.Name = p.name
	end
	for k, v in pairs(p.properties or {}) do
		local okSet, errSet = pcall(function()
			i[k] = dec(v, k)
		end)
		if not okSet then
			i:Destroy()
			error("property " .. tostring(k) .. ": " .. tostring(errSet))
		end
	end
	i.Parent = par
	logEdit("create", pathOf(i), nil, p["class"])
	return pathOf(i)
end

function handlers.delete(p)
	local i = resolve(p.path)
	if not i then
		error("path not found")
	end
	local n = pathOf(i)
	i:Destroy()
	logEdit("delete", n)
	return "deleted"
end

function handlers.move(p)
	local i = resolve(p.path)
	local np = resolve(p.new_parent)
	if not (i and np) then
		error("path not found")
	end
	i.Parent = np
	logEdit("move", pathOf(i), nil, p.new_parent)
	return "moved"
end

function handlers.read_script(p)
	local i = resolve(p.path)
	if not (i and i:IsA("LuaSourceContainer")) then
		error("not a script")
	end
	return { source = i.Source, class = i.ClassName }
end

function handlers.write_script(p)
	local i = resolve(p.path)
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
	return pathOf(i)
end

function handlers.patch_script(p)
	local i = resolve(p.path)
	if not (i and i:IsA("LuaSourceContainer")) then
		error("not a script")
	end
	local s, e = string.find(i.Source, p.find, 1, true)
	if not s then
		error("text to replace not found")
	end
	i.Source = string.sub(i.Source, 1, s - 1) .. p.replace .. string.sub(i.Source, e + 1)
	logEdit("patch_script", pathOf(i))
	return "patched"
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

-- Server-side harness injected for the duration of a test. It collects errors and ends the test.
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
local lastTest = nil

local function installHarness()
	local old = game:GetService("ServerScriptService"):FindFirstChild(HARNESS_NAME)
	if old then
		old:Destroy()
	end
	local sc = Instance.new("Script")
	sc.Name = HARNESS_NAME
	sc.Source = HARNESS_SRC
	sc.Parent = game:GetService("ServerScriptService")
	return sc
end

local function removeHarness()
	local old = game:GetService("ServerScriptService"):FindFirstChild(HARNESS_NAME)
	if old then
		old:Destroy()
	end
end

function handlers.playtest_start(p)
	if testRunning then
		error("a playtest is already running")
	end
	local okSvc, STS = pcall(function()
		return game:GetService("StudioTestService")
	end)
	if not okSvc or not STS then
		error("This Studio version has no StudioTestService. Ask the user to press Play, then read the Output.")
	end
	local seconds = math.clamp(tonumber(p.seconds) or 10, 2, 120)
	local mode = p.mode
	installHarness()
	testRunning = true
	task.spawn(function()
		local ok, res = pcall(function()
			if mode == "run" then
				return STS:ExecuteRunModeAsync({ seconds = seconds })
			end
			return STS:ExecutePlayModeAsync({ seconds = seconds })
		end)
		testRunning = false
		removeHarness()
		if ok then
			lastTest = { ok = true, result = res }
		else
			lastTest = { ok = false, error = tostring(res) }
		end
	end)
	return { started = true, seconds = seconds, mode = mode or "play", note = "Test is running. Call get_playtest_logs after about " .. seconds .. " seconds." }
end

function handlers.playtest_stop()
	local ok, STS = pcall(function()
		return game:GetService("StudioTestService")
	end)
	if ok and STS and testRunning then
		pcall(function()
			STS:EndTest({ ok = true, stopped = true })
		end)
		return "stop requested"
	end
	return "no test is running"
end

function handlers.get_playtest_logs()
	return { running = testRunning, last_test = lastTest, note = "Output lines are also uploaded automatically." }
end

function handlers.get_selection()
	local o = {}
	for _, s in ipairs(Selection:Get()) do
		table.insert(o, pathOf(s))
	end
	return o
end

function handlers.snapshot_save(p)
	local id = #snapshots + 1
	local saved = {}
	for _, c in ipairs(workspace:GetChildren()) do
		if not c:IsA("Terrain") and not c:IsA("Camera") then
			local ok, cl = pcall(function()
				return c:Clone()
			end)
			if ok and cl then
				table.insert(saved, cl)
			end
		end
	end
	snapshots[id] = saved
	return { id = id, label = p.label, count = #saved }
end

function handlers.snapshot_restore(p)
	local s = snapshots[p.id]
	if not s then
		error("no such snapshot")
	end
	for _, c in ipairs(workspace:GetChildren()) do
		if not c:IsA("Terrain") and not c:IsA("Camera") then
			c:Destroy()
		end
	end
	for _, c in ipairs(s) do
		c:Clone().Parent = workspace
	end
	return "restored"
end

-- Scene report: a text "screenshot" the AI can read. Works on every Studio build.
local function r2(n)
	return math.floor(n * 100 + 0.5) / 100
end

local function sceneReport()
	local cam = workspace.CurrentCamera
	local rep = { camera = {}, lighting = {}, nearby = {}, counts = {} }
	if cam then
		local p = cam.CFrame.Position
		rep.camera = { position = { r2(p.X), r2(p.Y), r2(p.Z) }, fov = cam.FieldOfView }
	end
	local L = game:GetService("Lighting")
	rep.lighting = { clock = L.ClockTime, brightness = L.Brightness, technology = tostring(L.Technology) }
	local origin = Vector3.new(0, 0, 0)
	if cam then
		origin = cam.CFrame.Position
	end
	local parts = {}
	local total = 0
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
		table.insert(rep.nearby, {
			path = pathOf(b), class = b.ClassName,
			pos = { r2(b.Position.X), r2(b.Position.Y), r2(b.Position.Z) },
			size = { r2(b.Size.X), r2(b.Size.Y), r2(b.Size.Z) },
			color = b.BrickColor.Name, material = tostring(b.Material), anchored = b.Anchored,
		})
	end
	rep.counts = { parts = total, models = #workspace:GetChildren() }
	return rep
end

function handlers.screenshot()
	return { kind = "scene_report", report = sceneReport(), note = "Studio plugins cannot read viewport pixels. This is a structured description of what the camera is looking at." }
end

function handlers.run_lua(p)
	if not runLuaEnabled then
		error("run_lua is OFF in the plugin")
	end
	local f, err = loadstring(p.code)
	if not f then
		error(err)
	end
	return tostring(f())
end

-- ---------- UI (Blocky Futurism, matches the website) ----------
local C = {
	bg = Color3.fromHex("0B0E14"), card = Color3.fromHex("141925"), card2 = Color3.fromHex("1B2233"),
	blue = Color3.fromHex("00A2FF"), green = Color3.fromHex("02FF8A"), red = Color3.fromHex("FF3B4E"),
	amber = Color3.fromHex("FFB800"), violet = Color3.fromHex("8B5CFF"),
	text = Color3.fromHex("E8EEF9"), mute = Color3.fromHex("8A96AD"),
}

local toolbar = plugin:CreateToolbar("BlockyAI")
local btn = toolbar:CreateButton("BlockyAI", "Open BlockyAI", "")
local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, true, false, 320, 520, 280, 360)
local widget = plugin:CreateDockWidgetPluginGui("BlockyAI", info)
widget.Title = "BlockyAI"

local function mk(class, props, parent)
	local o = Instance.new(class)
	for k, v in pairs(props) do
		o[k] = v
	end
	o.Parent = parent
	return o
end

local function corner(o, r)
	mk("UICorner", { CornerRadius = UDim.new(0, r or 8) }, o)
end

local function stroke(o, col, th)
	mk("UIStroke", { Color = col, Thickness = th or 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, o)
end

local root = mk("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = C.bg, BorderSizePixel = 0 }, widget)
mk("UIPadding", { PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 12), PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }, root)
mk("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }, root)

-- header: logo cube + name + live status chip
local header = mk("Frame", { Size = UDim2.new(1, 0, 0, 34), BackgroundTransparency = 1, LayoutOrder = 1 }, root)
local logo = mk("Frame", { Size = UDim2.fromOffset(30, 30), BackgroundColor3 = C.blue, BorderSizePixel = 0 }, header)
corner(logo, 7)
mk("TextLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Text = "B", Font = Enum.Font.FredokaOne, TextSize = 20, TextColor3 = C.bg }, logo)
mk("TextLabel", {
	Position = UDim2.fromOffset(38, 0), Size = UDim2.new(1, -120, 1, 0), BackgroundTransparency = 1, Text = "BlockyAI",
	Font = Enum.Font.FredokaOne, TextSize = 20, TextColor3 = C.text, TextXAlignment = Enum.TextXAlignment.Left,
}, header)
local chip = mk("TextLabel", {
	AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, 0, 0.5, 0), Size = UDim2.fromOffset(78, 22),
	BackgroundColor3 = C.card2, Text = "OFFLINE", Font = Enum.Font.GothamBold, TextSize = 11, TextColor3 = C.mute,
}, header)
corner(chip, 11)

-- connection card
local conn = mk("Frame", { Size = UDim2.new(1, 0, 0, 132), BackgroundColor3 = C.card, BorderSizePixel = 0, LayoutOrder = 2 }, root)
corner(conn, 10)
stroke(conn, C.card2, 1)
mk("UIPadding", { PaddingTop = UDim.new(0, 10), PaddingBottom = UDim.new(0, 10), PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) }, conn)
mk("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, conn)
local status = mk("TextLabel", {
	Size = UDim2.new(1, 0, 0, 30), BackgroundTransparency = 1, TextColor3 = C.mute, TextWrapped = true, Text = "Enter the 6 character code from the website.",
	Font = Enum.Font.Gotham, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, LayoutOrder = 1,
}, conn)
local box = mk("TextBox", {
	Size = UDim2.new(1, 0, 0, 34), PlaceholderText = "PAIRING CODE", PlaceholderColor3 = C.mute, Text = "", ClearTextOnFocus = false,
	BackgroundColor3 = C.bg, TextColor3 = C.green, Font = Enum.Font.Code, TextSize = 18, LayoutOrder = 2,
}, conn)
corner(box, 8)
stroke(box, C.card2, 1)
local connect = mk("TextButton", {
	Size = UDim2.new(1, 0, 0, 34), Text = "CONNECT", Font = Enum.Font.GothamBold, TextSize = 14, TextColor3 = C.bg,
	BackgroundColor3 = C.green, AutoButtonColor = true, LayoutOrder = 3,
}, conn)
corner(connect, 8)

-- activity feed
local feedHead = mk("TextLabel", {
	Size = UDim2.new(1, 0, 0, 16), BackgroundTransparency = 1, Text = "ACTIVITY", Font = Enum.Font.GothamBold, TextSize = 11,
	TextColor3 = C.mute, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 3,
}, root)
local feed = mk("ScrollingFrame", {
	Size = UDim2.new(1, 0, 1, -270), BackgroundColor3 = C.card, BorderSizePixel = 0, ScrollBarThickness = 4, ScrollBarImageColor3 = C.blue,
	CanvasSize = UDim2.new(0, 0, 0, 0), AutomaticCanvasSize = Enum.AutomaticSize.Y, LayoutOrder = 4,
}, root)
corner(feed, 10)
stroke(feed, C.card2, 1)
mk("UIPadding", { PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }, feed)
mk("UIListLayout", { Padding = UDim.new(0, 5), SortOrder = Enum.SortOrder.LayoutOrder }, feed)
local feedCount = 0

local function addFeed(text, col)
	feedCount += 1
	local row = mk("TextLabel", {
		Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundColor3 = C.card2, BorderSizePixel = 0,
		Text = text, TextColor3 = col or C.text, Font = Enum.Font.Code, TextSize = 12, TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = feedCount,
	}, feed)
	corner(row, 6)
	mk("UIPadding", { PaddingTop = UDim.new(0, 5), PaddingBottom = UDim.new(0, 5), PaddingLeft = UDim.new(0, 7), PaddingRight = UDim.new(0, 7) }, row)
	if feedCount > 60 then
		for _, ch in ipairs(feed:GetChildren()) do
			if ch:IsA("TextLabel") and ch.LayoutOrder == feedCount - 60 then
				ch:Destroy()
			end
		end
	end
	feed.CanvasPosition = Vector2.new(0, 1e6)
end

-- run_lua safety toggle
local lua = mk("TextButton", {
	Size = UDim2.new(1, 0, 0, 30), Text = "", Font = Enum.Font.GothamBold, TextSize = 12, BackgroundColor3 = C.card, LayoutOrder = 5,
}, root)
corner(lua, 8)
stroke(lua, C.card2, 1)

local function setChip(text, col)
	chip.Text = text
	chip.TextColor3 = col
end

local function paintLua()
	if runLuaEnabled then
		lua.Text = "run_lua: ON (risky)"
		lua.TextColor3 = C.amber
	else
		lua.Text = "run_lua: OFF (safe)"
		lua.TextColor3 = C.mute
	end
end
paintLua()

lua.MouseButton1Click:Connect(function()
	runLuaEnabled = not runLuaEnabled
	plugin:SetSetting("blockyai_runlua", runLuaEnabled)
	paintLua()
	addFeed("run_lua turned " .. (runLuaEnabled and "ON" or "OFF"), runLuaEnabled and C.amber or C.mute)
end)

btn.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

-- ---------- poll loop ----------
local logBuf = {}
LogService.MessageOut:Connect(function(msg, kind)
	table.insert(logBuf, { level = tostring(kind), message = string.sub(msg, 1, 400), source = "output" })
	if #logBuf > 300 then
		table.remove(logBuf, 1)
	end
end)

local running = false
local function loop()
	if running then
		return
	end
	running = true
	while token do
		local data, code = post("plugin-poll", {}, true)
		if code == 401 then
			token = nil
			plugin:SetSetting("blockyai_token", nil)
			status.Text = "Token rejected. Pair again with a new code."
			status.TextColor3 = C.red
			setChip("OFFLINE", C.red)
			break
		end
		if data then
			status.Text = "Connected. Chat with Blocky on the website."
			status.TextColor3 = C.green
			setChip(testRunning and "TESTING" or "LIVE", testRunning and C.amber or C.green)
		else
			status.Text = "Reconnecting... " .. tostring(code)
			status.TextColor3 = C.amber
			setChip("RETRY", C.amber)
		end
		local commands = {}
		if data and data.commands then
			commands = data.commands
		end
		for _, c in ipairs(commands) do
			local ok, res
			addFeed("> " .. tostring(c.type), C.blue)
			if ALLOWED[c.type] then
				ok, res = pcall(handlers[c.type], c.payload or {})
			else
				ok, res = false, "command type not allowed"
			end
			if ok then
				addFeed("  done", C.green)
			else
				addFeed("  failed: " .. string.sub(tostring(res), 1, 120), C.red)
			end
			local body = { command_id = c.id, ok = ok, edit_log = editLog, playtest_logs = logBuf }
			if ok then
				body.result = res
			else
				body.error = tostring(res)
			end
			editLog = {}
			logBuf = {}
			post("plugin-result", body, true)
		end
		if not data then
			task.wait(3)
		end
	end
	running = false
end

connect.MouseButton1Click:Connect(function()
	local cleaned = string.upper((string.gsub(box.Text or "", "%s", "")))
	local placeName = "Untitled place"
	if game.Name ~= "" then
		placeName = game.Name
	end
	local data, code = post("plugin-pair", { code = cleaned, place_name = placeName }, false)
	if data and data.token then
		token = data.token
		plugin:SetSetting("blockyai_token", token)
		status.Text = "Paired!"
		status.TextColor3 = C.green
		addFeed("Paired with the website", C.green)
		task.spawn(loop)
	else
		status.Text = "Pairing failed (" .. tostring(code) .. "). Check the code and try again."
		status.TextColor3 = C.red
	end
end)

if token then
	status.Text = "Reconnecting..."
	task.spawn(loop)
end
