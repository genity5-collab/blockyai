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

local function dec(v)
	if type(v) ~= "table" or not v._t then
		return v
	end
	if v._t == "Vector3" then
		return Vector3.new(v[1], v[2], v[3])
	elseif v._t == "Color3" then
		return Color3.new(v[1], v[2], v[3])
	elseif v._t == "UDim2" then
		return UDim2.new(v[1], v[2], v[3], v[4])
	elseif v._t == "CFrame" then
		return CFrame.new(table.unpack(v))
	elseif v._t == "Enum" then
		local parts = string.split(v[1], ".")
		return Enum[parts[2]][parts[3]]
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
		i[k] = dec(v)
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
		i[k] = dec(v)
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

function handlers.playtest_start()
	error("Plugins cannot start a playtest from code. Ask the user to press Play/Run in Studio; Output is captured automatically.")
end

function handlers.playtest_stop()
	error("Plugins cannot stop a playtest from code. Ask the user to press Stop.")
end

function handlers.get_playtest_logs()
	return "logs are uploaded automatically"
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

function handlers.screenshot()
	error("Screenshots are not available to plugins. Verify using get_tree and the Output instead.")
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

-- ---------- UI ----------
local toolbar = plugin:CreateToolbar("BlockyAI")
local btn = toolbar:CreateButton("BlockyAI", "Connect to BlockyAI", "")
local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, true, false, 300, 240, 260, 200)
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

local frame = mk("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(23, 26, 33) }, widget)
mk("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, frame)
mk("UIPadding", { PaddingTop = UDim.new(0, 10), PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) }, frame)
local status = mk("TextLabel", {
	Size = UDim2.new(1, 0, 0, 36), BackgroundTransparency = 1, TextColor3 = Color3.new(1, 1, 1),
	TextWrapped = true, Text = "Not connected", TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1,
}, frame)
local box = mk("TextBox", {
	Size = UDim2.new(1, 0, 0, 32), PlaceholderText = "Pairing code", Text = "", ClearTextOnFocus = false, LayoutOrder = 2,
}, frame)
local connect = mk("TextButton", { Size = UDim2.new(1, 0, 0, 32), Text = "Connect", LayoutOrder = 3 }, frame)
local lua = mk("TextButton", { Size = UDim2.new(1, 0, 0, 28), Text = "", LayoutOrder = 4 }, frame)

local function paintLua()
	if runLuaEnabled then
		lua.Text = "run_lua: ON (risky)"
	else
		lua.Text = "run_lua: OFF"
	end
end
paintLua()

lua.MouseButton1Click:Connect(function()
	runLuaEnabled = not runLuaEnabled
	plugin:SetSetting("blockyai_runlua", runLuaEnabled)
	paintLua()
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
			status.Text = "Token rejected. Re-pair."
			break
		end
		if data then
			status.Text = "Connected to BlockyAI"
		else
			status.Text = "Reconnecting... " .. tostring(code)
		end
		local commands = {}
		if data and data.commands then
			commands = data.commands
		end
		for _, c in ipairs(commands) do
			local ok, res
			if ALLOWED[c.type] then
				ok, res = pcall(handlers[c.type], c.payload or {})
			else
				ok, res = false, "command type not allowed"
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
		task.spawn(loop)
	else
		status.Text = "Pairing failed (" .. tostring(code) .. ")"
	end
end)

if token then
	task.spawn(loop)
end
