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
--@@MODULE:bridge@@
--@@MODULE:selftest@@
--@@MODULE:builder@@
--@@MODULE:transform@@
--@@MODULE:uibuild@@
--@@MODULE:studio_cmds@@
--@@MODULE:ui@@
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
local handlers: { [string]: (any, any?) -> any } = {}
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
function handlers.batch(p, ctl)
	local results = {}
	for n, c in ipairs(p.commands or {}) do
		-- Stop was pressed: do not start any more sub-commands. The ones already done stay done, and the result says where it stopped.
		if ctl and ctl.cancelled and ctl.cancelled() then
			for m = n, #p.commands do
				results[m] = { ok = false, error = "skipped: Stop was pressed before this step ran" }
			end
			break
		end
		if not ALLOWED[c.type] or c.type == "run_lua" or c.type == "batch" then
			results[n] = { ok = false, error = "not allowed in batch" }
		else
			local ok, r = pcall(function()
				return handlers[c.type](c.payload or {}, ctl)
			end)
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
	heartbeat = function(id: string): boolean?
		-- the server answers { alive = false } once Stop / cancel hit this command; Bridge turns that into ctl.cancelled()
		local data, err = post("plugin-ack", { command_id = id, heartbeat = true }, true)
		return Bridge.aliveFrom(data, err)
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
