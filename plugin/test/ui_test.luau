local Mock = require("./mock")
local env = setmetatable({}, { __index = _G })
Mock.install(env)
-- ui.luau needs these services/types
env.game = { GetService = function(_, name) return { Create = function() return { Play = function() end } end, AddTag = function() end } end }
env.TweenInfo = env.TweenInfo or { new = function() return {} end }
local function load(m: string): any
	local fn = assert(loadstring(require(m) :: string, "@" .. m)); setfenv(fn, env); return fn()
end
local UI = load("./ui_src")
local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail ~= nil and (" :: " .. tostring(detail)) or "")) end
end
local function near(a: number, b: number): boolean return math.abs(a - b) < 0.005 end

-- theme: defaults, valid override accepted, invalid ignored (this is the "JSON only, validated" safety property)
local t0 = UI.makeTheme(nil)
check("default blue is 00A2FF", near(t0.blue.R, 0) and near(t0.blue.G, 162 / 255))
local t1 = UI.makeTheme({ blue = "#FF0000", green = "not a color", evil = "#123456", red = 5, bg = "#0B0E14" })
check("valid hex override applied", near(t1.blue.R, 1) and near(t1.blue.G, 0))
check("invalid hex ignored (keeps default)", near(t1.green.G, 1.0) )
check("unknown key ignored (no new theme entries)", t1.evil == nil)
check("non-string value ignored", near(t1.red.R, 1))
check("short hex rejected", UI.makeTheme({ blue = "#FFF" }).blue.R < 0.01)
check("hex without # rejected", UI.makeTheme({ blue = "FF0000" }).blue.R < 0.01)

-- row pool: never more than 200 rows exist
local parent = env.Instance.new("Model")
local list = UI.makeList(parent, t0)
for i = 1, 450 do list.add("line " .. i, nil, nil, nil) end
check("list capped at 200 rows", list.count() == 200, list.count())
check("oldest rows were recycled, not leaked (instances stay bounded)", #parent:GetDescendants() < 200 * 6, #parent:GetDescendants())
list.clear()
check("clear empties the list", list.count() == 0)
local row = list.add(string.rep("x", 2000))
check("row text is truncated to 500 chars", #row.Text.Text == 500, #row.Text.Text)

-- plan bar math
local widget = env.Instance.new("Model")
local h = UI.build(widget, t0, { app = "BlockyAI" })
check("build returns the handles main needs", h.connect and h.codeBox and h.chatSend and h.stop and h.modalYes and h.modalNo and h.banner and h.tiles[6])
UI.setPlan(h, t0, { title = "Yacht", items = { { done = true }, { done = true }, { done = false }, { done = false } } })
check("plan bar visible with 2/4", h.planBar.Visible == true and h.planText.Text == "Yacht  2/4", h.planText.Text)
UI.setPlan(h, t0, nil)
check("plan bar hides with no plan", h.planBar.Visible == false)
UI.setPlan(h, t0, { items = {} })
check("empty plan hides the bar", h.planBar.Visible == false)

-- pairing tiles
UI.setCode(h, "ab-c 12!3xyz")
local code = {} for i = 1, 6 do table.insert(code, h.tiles[i].Text) end
check("pairing tiles: cleaned, uppercased, max 6", table.concat(code) == "ABC123", table.concat(code))
UI.setCode(h, "")
check("tiles clear", h.tiles[1].Text == "")

-- status chip
UI.setStatus(h, t0, "LIVE"); check("LIVE is green", h.chip.Text == "LIVE" and near(h.chip.BackgroundColor3.G, 1))
UI.setStatus(h, t0, "garbage"); check("unknown status falls back to OFFLINE red", h.chip.Text == "OFFLINE" and near(h.chip.BackgroundColor3.R, 1))

-- connected switch
UI.setConnected(h, true)
check("connected shows tabs, hides pairing", h.pair.Visible == false and h.tabBar.Visible == true and h.info.Visible == true)
check("Activity tab is the default page", h.tabPages["Activity"].Visible == true and h.tabPages["Console"].Visible == false)
h.showTab("Chat")
check("switching tabs shows only one page", h.tabPages["Chat"].Visible == true and h.tabPages["Activity"].Visible == false)
UI.setConnected(h, false)
check("disconnected shows pairing again", h.pair.Visible == true and h.tabBar.Visible == false)

-- overlay + toggles
UI.toggleLabel(h.luaToggle, "run_lua", false, t0)
check("toggle label OFF", h.luaToggle.Text == "run_lua: OFF")
UI.toggleLabel(h.luaToggle, "run_lua", true, t0)
check("toggle label ON in green", h.luaToggle.Text == "run_lua: ON" and near(h.luaToggle.TextColor3.G, 1))
check("run_lua warning text mentions the risk", string.find(h.luaWarn.Text, "any code") ~= nil)
check("banner starts hidden (no update shown unless the server says so)", h.banner.Visible == false)
check("modal starts hidden", h.modal.Visible == false)

print(string.format("ui: %d passed, %d failed", passed, failed))
if failed > 0 then error("ui tests failed") end
