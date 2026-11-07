local Mock = require("./mock")
local env = setmetatable({}, { __index = _G })
Mock.install(env)
local function load(srcmod: string): any
	local fn = assert(loadstring(require(srcmod) :: string, "@" .. srcmod))
	setfenv(fn, env)
	return fn()
end
local Builder = load("./builder_src")
local T = load("./transform_src")

local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail ~= nil and (" :: " .. tostring(detail)) or "")) end
end
local function near(a: number, b: number, eps: number?): boolean return math.abs(a - b) <= (eps or 0.01) end
local V3 = env.Vector3
local ws = env.workspace
local api = { yield = function() end, raycast = function() return nil end }

local function box(name: string, size: {number}, pos: {number}): any
	local r = Builder.build(ws, { name = name, class = "Model", children = { { name = "P", class = "Part", size = size, position = pos } } })
	return r.instance
end

-- bounding box + describe
local b1 = box("B1", { 4, 2, 6 }, { 10, 5, -3 })
local bb = T.boundingBox(b1)
check("bbox size", near(bb.size.X, 4) and near(bb.size.Y, 2) and near(bb.size.Z, 6))
check("bbox center", near(bb.center.X, 10) and near(bb.center.Y, 5) and near(bb.center.Z, -3))
check("describeBox rounds and lists min/max", T.describeBox(b1).min[2] == 4 and T.describeBox(b1).max[2] == 6)
check("empty model has no box", T.describeBox(env.Instance.new("Model")).ok == false)

-- measure: gap and overlap
local a = box("MA", { 2, 2, 2 }, { 0, 0, 0 })
local c = box("MC", { 2, 2, 2 }, { 5, 0, 0 })
local m = T.measure(a, c)
check("center distance 5", near(m.center_distance, 5))
check("gap X = 3", near(m.gap[1], 3), m.gap[1])
check("not overlapping", m.overlapping == false)
local d = box("MD", { 2, 2, 2 }, { 1, 0, 0 })
check("overlap detected", T.measure(a, d).overlapping == true)

-- duplicate_array
local seed = box("Fence", { 1, 4, 1 }, { 0, 2, 0 })
local arr = T.duplicateArray(seed, 4, V3.new(3, 0, 0), api)
check("array copies", arr.ok and arr.copies == 4 and arr.parts_created == 4)
local last = seed.Parent:FindFirstChild("Fence_4")
check("copy 4 is at x=12", last and near(T.boundingBox(last).center.X, 12), last and T.boundingBox(last).center.X)
check("original untouched", near(T.boundingBox(seed).center.X, 0))
check("array count limit", T.duplicateArray(seed, 501, V3.zero, api).ok == false)

-- duplicate_grid 3x2 -> 5 new copies (original is cell 0,0)
local gseed = box("Tree", { 1, 1, 1 }, { 0, 0, 0 })
local g = T.duplicateGrid(gseed, 3, 2, 10, 20, api)
check("grid creates nx*nz-1 copies", g.ok and g.copies == 5, g.copies)
check("grid cell (2,1) at x=20 z=20", (function() local x = ws:FindFirstChild("Tree_2_1_0"); return x and near(T.boundingBox(x).center.X, 20) and near(T.boundingBox(x).center.Z, 20) end)())
check("grid size guard", T.duplicateGrid(gseed, 40, 40, 1, 1, api).ok == false)

-- along path: 3 copies on a straight 0..20 line -> x = 0, 10, 20
local pseed = box("Lamp", { 1, 1, 1 }, { 0, 0, 0 })
local ap = T.duplicateAlongPath(pseed, { V3.new(0, 0, 0), V3.new(20, 0, 0) }, 3, api)
check("path copies", ap.ok and ap.copies == 3 and near(ap.path_length, 20))
check("path middle copy at x=10", near(T.boundingBox(ws:FindFirstChild("Lamp_p2")).center.X, 10))
check("path end copy at x=20", near(T.boundingBox(ws:FindFirstChild("Lamp_p3")).center.X, 20))
check("path needs 2 points", T.duplicateAlongPath(pseed, { V3.zero }, 3, api).ok == false)

-- mirror across X plane at 0: part at x=7 -> -7
local mseed = box("Wing", { 2, 1, 4 }, { 7, 1, 0 })
local mr = T.mirror(mseed, "x", 0, api)
check("mirror ok", mr.ok and mr.parts == 1)
check("mirrored x = -7", near(T.boundingBox(ws:FindFirstChild("Wing_mirrorX")).center.X, -7))
check("mirror keeps y and z", near(T.boundingBox(ws:FindFirstChild("Wing_mirrorX")).center.Y, 1))
check("mirror warns about orientation", string.find(mr.note, "orientations") ~= nil)
check("bad axis rejected", T.mirror(mseed, "Q", 0, api).ok == false)

-- scale: 2x about the center. 4x2x6 box centered (10,5,-3) -> 8x4x12 same center
local sc = box("Scale", { 4, 2, 6 }, { 10, 5, -3 })
local sr = T.scaleModel(sc, 2, api)
check("scaled size doubles", sr.ok and near(sr.size_after[1], 8) and near(sr.size_after[3], 12), sr.size_after and sr.size_after[1])
check("center preserved", near(T.boundingBox(sc).center.X, 10) and near(T.boundingBox(sc).center.Y, 5))
check("scale limits", T.scaleModel(sc, 0, api).ok == false and T.scaleModel(sc, 51, api).ok == false)
-- scaling a two-part model scales the GAP between parts too
local two = Builder.build(ws, { name = "Two", class = "Model", children = { { name = "L", class = "Part", size = { 2, 2, 2 }, position = { -5, 0, 0 } }, { name = "R", class = "Part", size = { 2, 2, 2 }, position = { 5, 0, 0 } } } }).instance
T.scaleModel(two, 3, api)
check("part spacing scales (distance 10 -> 30)", near(T.boundingBox(two:FindFirstChild("R")).center.X - T.boundingBox(two:FindFirstChild("L")).center.X, 30))

-- align (min on Y) and distribute
local i1, i2, i3 = box("A1", { 2, 2, 2 }, { 0, 5, 0 }), box("A2", { 2, 6, 2 }, { 10, 0, 0 }), box("A3", { 2, 4, 2 }, { 20, 9, 0 })
T.align({ i1, i2, i3 }, "Y", "min")
check("align min Y: all bottoms at 4", near(T.boundingBox(i2).min.Y, 4) and near(T.boundingBox(i3).min.Y, 4), T.boundingBox(i2).min.Y)
local d1, d2, d3, d4 = box("D1", { 1, 1, 1 }, { 0, 0, 0 }), box("D2", { 1, 1, 1 }, { 3, 0, 0 }), box("D3", { 1, 1, 1 }, { 4, 0, 0 }), box("D4", { 1, 1, 1 }, { 30, 0, 0 })
local dr = T.distribute({ d1, d2, d3, d4 }, "X")
check("distribute spacing 10", dr.ok and near(dr.spacing, 10))
check("D2 at 10 and D3 at 20", near(T.boundingBox(d2).center.X, 10) and near(T.boundingBox(d3).center.X, 20))
check("distribute needs 3", T.distribute({ d1, d2 }, "X").ok == false)

-- snap_to_ground with a fake ground at y=7, and one item over a void
local ground = function(origin: any) if origin.X > 100 then return nil end return { position = V3.new(origin.X, 7, origin.Z), normal = V3.new(0, 1, 0), instance = { Name = "Terrain" } } end
local snapApi = { yield = function() end, raycast = ground }
local t1, t2 = box("T1", { 2, 10, 2 }, { 0, 50, 0 }), box("T2", { 2, 10, 2 }, { 500, 50, 0 })
local sg = T.snapToGround({ t1, t2 }, snapApi)
check("1 snapped 1 missed", sg.snapped == 1 and sg.missed == 1)
check("tree bottom now rests on ground y=7", near(T.boundingBox(t1).min.Y, 7), T.boundingBox(t1).min.Y)
check("missed item left untouched and reported", near(T.boundingBox(t2).center.Y, 50) and sg.results[2].ok == false)
check("snap offset", (function() local t3 = box("T3", { 2, 2, 2 }, { 0, 20, 0 }); T.snapToGround({ t3 }, snapApi, -1); return near(T.boundingBox(t3).min.Y, 6) end)())

-- find_empty_space: area 0..40, one obstacle in the middle-left
local obst = box("Obst", { 10, 4, 10 }, { 10, 0, 10 })
local fs = T.findEmptySpace(V3.new(8, 4, 8), { min = V3.new(0, 0, 0), max = V3.new(40, 0, 40) }, { obst }, 8, 0)
check("finds free spots", fs.ok and #fs.spots > 0)
local clear = true
for _, s in ipairs(fs.spots) do if math.abs(s[1] - 10) < 9 and math.abs(s[3] - 10) < 9 then clear = false end end
check("no returned spot overlaps the obstacle", clear)
check("full area blocked -> reports none", T.findEmptySpace(V3.new(8, 4, 8), { min = V3.new(0, 0, 0), max = V3.new(10, 0, 10) }, { box("Big", { 20, 4, 20 }, { 5, 0, 5 }) }, 8, 0).ok == false)

print(string.format("transform: %d passed, %d failed", passed, failed))
if failed > 0 then error("transform tests failed") end
