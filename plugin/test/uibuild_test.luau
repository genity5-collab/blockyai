local Mock = require("./mock")
local env = setmetatable({}, { __index = _G })
Mock.install(env)
local function load(m: string): any
	local fn = assert(loadstring(require(m) :: string, "@" .. m)); setfenv(fn, env); return fn()
end
local UI = load("./uibuild_src")
local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail ~= nil and (" :: " .. tostring(detail)) or "")) end
end
local gui = env.Instance.new("Model")
local r = UI.build(gui, {
	name = "ShopGui", children = {
		{ class = "Frame", name = "Panel", size = { 0, 300, 0, 200 }, position = { 0.5, 0, 0.5, 0 }, anchor = { 0.5, 0.5 }, color = "#141925", corner = 10,
		  stroke = { color = "#00A2FF", thickness = 2 }, layout = { type = "list", gap = 8 }, padding = 12,
		  children = {
			{ class = "TextLabel", name = "Title", text = "SHOP", text_size = 24, text_color = "#FFFFFF", size = { 1, 0, 0, 30 } },
			{ class = "TextButton", name = "Buy", text = "Buy Sword (50)", color = "#00A2FF", size = { 1, 0, 0, 40 }, corner = 8, attributes = { ItemId = "sword" } },
		  } },
	},
})
check("builds ok", r.ok, r.error)
check("root is a ScreenGui", r.instance.ClassName == "ScreenGui")
local panel = r.instance:FindFirstChild("Panel")
check("panel size offsets", panel.Size.X.Offset == 300 and panel.Size.Y.Offset == 200)
check("panel centered with anchor", panel.Position.X.Scale == 0.5 and panel.AnchorPoint.X == 0.5)
check("corner + stroke + layout + padding children exist", panel:FindFirstChild("UICorner") and panel:FindFirstChild("UIStroke") and panel:FindFirstChild("Layout") and panel:FindFirstChild("Padding"))
local buy = panel:FindFirstChild("Buy")
check("button text", buy.Text == "Buy Sword (50)")
check("attribute set for the client script to read", buy:GetAttribute("ItemId") == "sword")
check("instance count (gui+panel+title+buy+corners+stroke+layout+padding)", r.count == 9, r.count)
check("no errors", #r.errors == 0, table.concat(r.errors, "|"))
local bad = UI.build(gui, { name = "B", children = { { class = "Part", name = "X" }, { class = "Frame", color = "zzz" } } })
check("disallowed class reported, build continues", bad.ok and string.find(table.concat(bad.errors, ""), "not allowed") ~= nil)
check("bad color reported", string.find(table.concat(bad.errors, ""), "zzz", 1, true) ~= nil)
check("non-ScreenGui root rejected", UI.build(gui, { class = "Frame", name = "X" }).ok == false)
check("text size clamped", (function() local x = UI.build(gui, { name = "C", children = { { class = "TextLabel", text_size = 9999 } } }); return x.instance:GetChildren()[1].TextSize == 96 end)())
print(string.format("uibuild: %d passed, %d failed", passed, failed))
if failed > 0 then error("uibuild tests failed") end
