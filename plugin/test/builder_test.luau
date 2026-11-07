-- Runs under plain `luau`. Loads the mock engine into globals, then loads the REAL builder source.
-- Load the REAL builder source unmodified, inside an environment that holds the mock engine.
-- The runner generates test/builder_src.luau which returns the builder source as a string (plain luau has no io library).
local Mock = require("./mock")
local env = setmetatable({}, { __index = _G })
Mock.install(env)
local src: string = require("./builder_src")
local fn = assert(loadstring(src, "@builder.luau"))
setfenv(fn, env)
local Builder = fn()

local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail and (" :: " .. tostring(detail)) or "")) end
end
local function near(a: number, b: number, eps: number?): boolean return math.abs(a - b) <= (eps or 0.01) end

-- 1. the exact example from the brief
local yacht = {
	name = "Yacht", class = "Model", primary_part = "Hull", weld = true,
	children = {
		{ name = "Hull", class = "Part", shape = "Block", size = { 12, 3, 40 }, position = { 0, 2, 0 }, rotation = { 0, 0, 0 }, color = "#F5F5F5", material = "SmoothPlastic", anchored = true },
		{ name = "Bow", class = "WedgePart", size = { 12, 3, 8 }, position = { 0, 2, 24 }, rotation = { 0, 180, 0 }, color = "#F5F5F5" },
		{ name = "Window", class = "Part", size = { 2, 1, 0.2 }, position = { 0, 6, 5 }, material = "Glass", transparency = 0.4, color = "#9AD7FF" },
		{ name = "Light", class = "PointLight", properties = { Brightness = 2, Range = 20 } },
	},
}
local ws = env.workspace
local r = Builder.build(ws, yacht)
check("yacht builds ok", r.ok, r.error)
check("instance count = model + 4 children", r.count == 5, r.count)
check("3 parts counted", r.parts == 3, r.parts)
check("PrimaryPart is Hull", r.primary_part == "Hull" and r.instance.PrimaryPart.Name == "Hull")
check("parented to workspace", r.instance.Parent == ws)
check("full name path", r.path == "Workspace.Yacht", r.path)
check("welded 2 non-primary parts", r.welds == 2, r.welds)
local hull = r.instance:FindFirstChild("Hull")
check("Hull size", hull.Size.X == 12 and hull.Size.Y == 3 and hull.Size.Z == 40)
check("Hull position y=2", near(hull.CFrame.Position.Y, 2))
check("hex color applied", near(hull.Color.R, 0xF5 / 255, 0.001))
check("material enum by short name", hull.Material == env.Enum.Material.SmoothPlastic)
check("anchored default true", hull.Anchored == true)
local win = r.instance:FindFirstChild("Window")
check("transparency", near(win.Transparency, 0.4))
check("glass", win.Material == env.Enum.Material.Glass)
local light = r.instance:FindFirstChild("Light")
check("light properties applied", light.Brightness == 2 and light.Range == 20)
check("no errors on a valid spec", #r.errors == 0, table.concat(r.errors, " | "))

-- bounding box of Hull alone is exact: 12x3x40 centered at (0,2,0). Bow is rotated 180deg about Y so it stays 12x3x8 at z=24.
-- Union extent: x[-6,6] y[0.5,3.5]... compute: hull y 0.5..3.5, bow y 0.5..3.5, window y 5.5..6.5 -> total y 0.5..6.5 = 6
-- z: hull -20..20, bow 20..28, window ~4.9..5.1 -> -20..28 = 48
check("bbox size X=12", near(r.bounding_box.size[1], 12), r.bounding_box.size[1])
check("bbox size Y=6", near(r.bounding_box.size[2], 6), r.bounding_box.size[2])
check("bbox size Z=48", near(r.bounding_box.size[3], 48), r.bounding_box.size[3])
check("bbox center z=4", near(r.bounding_box.center[3], 4), r.bounding_box.center[3])

-- 2. relative positioning: a sub-model offset moves its children
local rel = Builder.build(ws, {
	name = "Offset", class = "Model", children = {
		{ name = "Sub", class = "Model", position = { 100, 0, 0 }, children = { { name = "P", class = "Part", size = { 1, 1, 1 }, position = { 5, 0, 0 } } } },
	},
})
check("nested model offsets children (100+5)", near(rel.instance:FindFirstChild("Sub"):FindFirstChild("P").CFrame.Position.X, 105))

-- 3. rotation: 90 degrees about Y turns +Z extent into X extent
local rot = Builder.build(ws, { name = "Rot", class = "Model", children = { { name = "Long", class = "Part", size = { 2, 2, 10 }, rotation = { 0, 90, 0 } } } })
check("rotated bbox: X extent 10", near(rot.bounding_box.size[1], 10), rot.bounding_box.size[1])
check("rotated bbox: Z extent 2", near(rot.bounding_box.size[3], 2), rot.bounding_box.size[3])

-- 4. errors are REPORTED per child and the build continues
local bad = Builder.build(ws, {
	name = "Bad", class = "Model", children = {
		{ name = "Good", class = "Part", size = { 1, 1, 1 } },
		{ name = "Nope", class = "NotARealClass" },
		{ name = "BadMat", class = "Part", material = "Unobtainium" },
		{ name = "BadColor", class = "Part", color = "not-a-color" },
		{ name = "NegSize", class = "Part", size = { -3, 1, 1 } },
	},
})
check("bad children do not abort the build", bad.ok and bad.count >= 4, bad.count)
local joined = table.concat(bad.errors, " | ")
check("unsupported class reported", string.find(joined, "NotARealClass") ~= nil, joined)
check("unknown material reported", string.find(joined, "Unobtainium") ~= nil, joined)
check("unknown color reported", string.find(joined, "not-a-color", 1, true) ~= nil, joined)
check("negative size reported", string.find(joined, "size must be positive") ~= nil, joined)
check("negative size clamped, not crashing", bad.instance:FindFirstChild("NegSize").Size.X > 0)

-- 5. scripts and prompts
local sc = Builder.build(ws, { name = "Door", class = "Model", children = {
	{ name = "Panel", class = "Part", size = { 4, 7, 0.5 }, children = { { name = "Prompt", class = "ProximityPrompt", action_text = "Open", distance = 8 } } },
	{ name = "DoorScript", class = "Script", source = "print('hi')" },
} })
local prompt = sc.instance:FindFirstChild("Panel"):FindFirstChild("Prompt")
check("ProximityPrompt configured", prompt.ActionText == "Open" and prompt.MaxActivationDistance == 8)
check("script source set", sc.instance:FindFirstChild("DoorScript").Source == "print('hi')")
local noscript = Builder.build(ws, { name = "NS", class = "Model", children = { { name = "S", class = "Script", source = "x" } } }, { allowScripts = false })
check("scripts can be disabled", string.find(table.concat(noscript.errors, ""), "scripts are disabled") ~= nil)
local nosrc = Builder.build(ws, { name = "NS2", class = "Model", children = { { name = "S", class = "Script" } } })
check("script without source is reported", #nosrc.errors == 1)

-- 6. constraints resolve by name, and fail loudly with unknown names
local con = Builder.build(ws, { name = "Con", class = "Model", children = {
	{ name = "A", class = "Part" }, { name = "B", class = "Part" },
	{ name = "W", class = "WeldConstraint", part0 = "A", part1 = "B" },
	{ name = "W2", class = "WeldConstraint", part0 = "A", part1 = "Ghost" },
} })
check("weld constraint resolved", con.instance:FindFirstChild("A"):FindFirstChild("W") ~= nil or #con.errors >= 1)
check("weld to unknown part reported", string.find(table.concat(con.errors, ""), "Ghost") ~= nil, table.concat(con.errors, "|"))

-- 7. limits and yielding
local yields = 0
local many = { name = "Many", class = "Model", children = {} }
for i = 1, 160 do table.insert(many.children, { name = "P" .. i, class = "Part", size = { 1, 1, 1 }, position = { i, 0, 0 } }) end
local m = Builder.build(ws, many, { yield = function() yields += 1 end })
check("160 parts built", m.parts == 160, m.parts)
check("yields roughly every 50 instances (3 for 161)", yields == 3, yields)
local capped = Builder.build(ws, many, { maxInstances = 100 })
check("instance cap enforced and reported", capped.count == 100 and string.find(table.concat(capped.errors, ""), "split the build") ~= nil, capped.count)

-- 8. input validation
check("missing name rejected", Builder.build(ws, { class = "Model" }).ok == false)
check("non-table spec rejected", Builder.build(ws, "yacht" :: any).ok == false)
check("primary_part naming a missing part is reported", string.find(table.concat(Builder.build(ws, { name = "PP", class = "Model", primary_part = "Zzz", children = { { name = "A", class = "Part" } } }).errors, ""), "primary_part") ~= nil)
check("MeshPart mesh id limitation is reported honestly", string.find(table.concat(Builder.build(ws, { name = "MP", class = "Model", children = { { name = "M", class = "MeshPart", mesh_id = "rbxassetid://1" } } }).errors, ""), "MeshId cannot be set") ~= nil)
check("Parent is set LAST (child appears only once built)", (function()
	local rr = Builder.build(ws, { name = "Last", class = "Model", children = { { name = "C", class = "Part" } } })
	return #rr.instance:GetChildren() == 1
end)())


-- 9. cooperative cancel (Phase 1 item 11): Stop must abort a build between steps, and an aborted build must leave NOTHING in the game
do
	local function wide(n: number) local kids = {} for i = 1, n do kids[i] = { name = "P" .. i, class = "Part", position = { i, 1, 0 } } end return { name = "Big", class = "Model", children = kids } end
	local before = #ws:GetChildren()
	local built, calls = 0, 0
	local r1 = Builder.build(ws, wide(50), { cancelled = function() calls += 1 return calls > 10 end })
	check("a cancelled build reports ok=false", r1.ok == false, r1.ok)
	check("a cancelled build says it was cancelled", r1.cancelled == true and string.find(tostring(r1.error), "cancel") ~= nil, r1.error)
	check("a cancelled build stopped EARLY (did not build all 50)", (r1.count or 0) < 50 and (r1.count or 0) >= 1, r1.count)
	check("a cancelled build leaves NOTHING in the workspace", #ws:GetChildren() == before, #ws:GetChildren() - before)
	local r2 = Builder.build(ws, wide(5), { cancelled = function() return false end })
	check("cancelled()==false builds normally", r2.ok == true and r2.count == 6, r2.count)
	local r3 = Builder.build(ws, wide(5))
	check("no cancelled callback builds normally", r3.ok == true)
	local r4 = Builder.build(ws, wide(5), { cancelled = function() return true end })
	check("cancelled before the first step builds nothing", r4.ok == false and r4.cancelled == true and #ws:GetChildren() == before + 2, #ws:GetChildren() - before)
	local ok = pcall(function() return Builder.build(ws, wide(5), { cancelled = function() error("flag broke") end }) end)
	check("a broken cancelled() callback never crashes a build", ok)
end

print(string.format("builder: %d passed, %d failed", passed, failed))
if failed > 0 then error("builder tests failed") end
