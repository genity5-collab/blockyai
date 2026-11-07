-- BlockyAI transform / query commands. Pure logic over Instances (Model/BasePart): duplicate, mirror, scale, align, distribute,
-- snap_to_ground, bounding box, pivot, measure. The Roblox-specific calls (Raycast, GetBoundingBox) are injected through `api`
-- so the same code runs in Studio and in the unit tests.
local T = {}

export type Api = {
	raycast: (origin: Vector3, direction: Vector3, ignore: { any }?) -> { position: Vector3, normal: Vector3, instance: any }?,
	yield: () -> (),
}

local function r2(n: number): number
	return math.floor(n * 100 + 0.5) / 100
end
local function v3(v: Vector3): { number }
	return { r2(v.X), r2(v.Y), r2(v.Z) }
end

local function partsOf(inst: any): { any }
	local out = {}
	if inst:IsA("BasePart") then
		table.insert(out, inst)
	end
	for _, d in ipairs(inst:GetDescendants()) do
		if d:IsA("BasePart") then
			table.insert(out, d)
		end
	end
	return out
end
T.partsOf = partsOf

-- axis-aligned world bounding box of every part (handles rotation by transforming all 8 corners)
function T.boundingBox(inst: any): { size: Vector3, center: Vector3, min: Vector3, max: Vector3, parts: number }?
	local parts = partsOf(inst)
	if #parts == 0 then
		return nil
	end
	local lo = Vector3.new(math.huge, math.huge, math.huge)
	local hi = Vector3.new(-math.huge, -math.huge, -math.huge)
	for _, p in ipairs(parts) do
		for _, sx in ipairs({ -0.5, 0.5 }) do
			for _, sy in ipairs({ -0.5, 0.5 }) do
				for _, sz in ipairs({ -0.5, 0.5 }) do
					local w = p.CFrame * Vector3.new(p.Size.X * sx, p.Size.Y * sy, p.Size.Z * sz)
					lo = Vector3.new(math.min(lo.X, w.X), math.min(lo.Y, w.Y), math.min(lo.Z, w.Z))
					hi = Vector3.new(math.max(hi.X, w.X), math.max(hi.Y, w.Y), math.max(hi.Z, w.Z))
				end
			end
		end
	end
	return { size = hi - lo, center = (lo + hi) / 2, min = lo, max = hi, parts = #parts }
end

function T.describeBox(inst: any): any
	local b = T.boundingBox(inst)
	if not b then
		return { ok = false, error = "no parts under " .. inst.Name }
	end
	return { ok = true, size = v3(b.size), center = v3(b.center), min = v3(b.min), max = v3(b.max), parts = b.parts }
end

function T.getPivot(inst: any): any
	local ok, cf = pcall(function()
		return inst:GetPivot()
	end)
	if not ok then
		return { ok = false, error = "instance has no pivot: " .. tostring(cf) }
	end
	return { ok = true, position = v3(cf.Position) }
end

function T.measure(a: any, b: any): any
	local ba, bb = T.boundingBox(a), T.boundingBox(b)
	if not ba or not bb then
		return { ok = false, error = "both instances need at least one part" }
	end
	local d = bb.center - ba.center
	-- gap along each axis between the two boxes (negative = overlap)
	local gx = math.max(ba.min.X - bb.max.X, bb.min.X - ba.max.X)
	local gy = math.max(ba.min.Y - bb.max.Y, bb.min.Y - ba.max.Y)
	local gz = math.max(ba.min.Z - bb.max.Z, bb.min.Z - ba.max.Z)
	return { ok = true, center_distance = r2(d.Magnitude), delta = v3(d), gap = { r2(gx), r2(gy), r2(gz) }, overlapping = gx < 0 and gy < 0 and gz < 0 }
end

local function movePartsBy(inst: any, delta: Vector3)
	for _, p in ipairs(partsOf(inst)) do
		p.CFrame = p.CFrame + delta
	end
end

-- Move a whole instance (Model or part) so its bounding-box center is at `target`.
function T.moveCenterTo(inst: any, target: Vector3): any
	local b = T.boundingBox(inst)
	if not b then
		return { ok = false, error = "nothing to move" }
	end
	movePartsBy(inst, target - b.center)
	return { ok = true }
end

local function cloneNamed(src: any, name: string, parent: any): any
	local c = src:Clone()
	c.Name = name
	c.Parent = parent
	return c
end

-- duplicate_array: `count` copies, each offset by `offset` from the previous one
function T.duplicateArray(src: any, count: number, offset: Vector3, api: Api): any
	if count < 1 or count > 500 then
		return { ok = false, error = "count must be 1..500" }
	end
	local made, created = {}, 0
	for i = 1, count do
		local c = cloneNamed(src, src.Name .. "_" .. i, src.Parent)
		movePartsBy(c, offset * i)
		table.insert(made, c.Name)
		created += #partsOf(c)
		if i % 25 == 0 then
			api.yield()
		end
	end
	return { ok = true, copies = count, parts_created = created, names = made }
end

function T.duplicateGrid(src: any, nx: number, nz: number, dx: number, dz: number, api: Api, ny: number?, dy: number?): any
	local layers = ny or 1
	if nx < 1 or nz < 1 or layers < 1 or nx * nz * layers > 1000 then
		return { ok = false, error = "grid too large: nx*nz*ny must be 1..1000" }
	end
	local n, parts = 0, 0
	for ix = 0, nx - 1 do
		for iz = 0, nz - 1 do
			for iy = 0, layers - 1 do
				if not (ix == 0 and iz == 0 and iy == 0) then
					local c = cloneNamed(src, string.format("%s_%d_%d_%d", src.Name, ix, iz, iy), src.Parent)
					movePartsBy(c, Vector3.new(ix * dx, iy * (dy or 0), iz * dz))
					n += 1
					parts += #partsOf(c)
					if n % 25 == 0 then
						api.yield()
					end
				end
			end
		end
	end
	return { ok = true, copies = n, parts_created = parts }
end

-- points: list of {x,y,z}; `count` copies are spaced evenly (by arc length) along the polyline
function T.duplicateAlongPath(src: any, points: { Vector3 }, count: number, api: Api): any
	if #points < 2 then
		return { ok = false, error = "path needs at least 2 points" }
	end
	if count < 1 or count > 500 then
		return { ok = false, error = "count must be 1..500" }
	end
	local lens, total = {}, 0
	for i = 1, #points - 1 do
		local l = (points[i + 1] - points[i]).Magnitude
		lens[i] = l
		total += l
	end
	if total <= 0 then
		return { ok = false, error = "path has zero length" }
	end
	local made = 0
	local origin = (T.boundingBox(src) :: any).center
	for i = 0, count - 1 do
		local want = (count == 1) and 0 or (total * i / (count - 1))
		local seg, acc = 1, 0
		while seg < #lens and acc + lens[seg] < want do
			acc += lens[seg]
			seg += 1
		end
		local t = lens[seg] > 0 and (want - acc) / lens[seg] or 0
		local pos = points[seg]:Lerp(points[seg + 1], t)
		local c = cloneNamed(src, src.Name .. "_p" .. (i + 1), src.Parent)
		movePartsBy(c, pos - origin)
		made += 1
		if made % 25 == 0 then
			api.yield()
		end
	end
	return { ok = true, copies = made, path_length = r2(total) }
end

-- mirror across a world axis plane through `at` (default: the instance's own center). Creates a mirrored COPY.
function T.mirror(src: any, axis: string, at: number?, api: Api): any
	local ax = string.upper(axis)
	if ax ~= "X" and ax ~= "Y" and ax ~= "Z" then
		return { ok = false, error = "axis must be X, Y or Z" }
	end
	local b = T.boundingBox(src)
	if not b then
		return { ok = false, error = "nothing to mirror" }
	end
	local plane = at or (b.center :: any)[ax]
	local c = cloneNamed(src, src.Name .. "_mirror" .. ax, src.Parent)
	local n = 0
	for _, p in ipairs(partsOf(c)) do
		local pos = p.Position
		local newPos = Vector3.new(ax == "X" and (2 * plane - pos.X) or pos.X, ax == "Y" and (2 * plane - pos.Y) or pos.Y, ax == "Z" and (2 * plane - pos.Z) or pos.Z)
		-- Mirroring flips handedness, which a CFrame cannot express. Reflecting the rotation matrix is skipped: parts keep their
		-- orientation and only their position reflects. That is exact for axis-aligned parts; wedges/stairs may need a 180 turn.
		p.CFrame = p.CFrame - pos + newPos
		n += 1
		if n % 50 == 0 then
			api.yield()
		end
	end
	return { ok = true, name = c.Name, parts = n, plane = r2(plane), note = "positions reflected; part orientations are not reflected (wedges may need rotation)" }
end

function T.scaleModel(inst: any, factor: number, api: Api): any
	if factor <= 0 or factor > 50 then
		return { ok = false, error = "factor must be > 0 and <= 50" }
	end
	local b = T.boundingBox(inst)
	if not b then
		return { ok = false, error = "nothing to scale" }
	end
	local pivot = b.center
	local n = 0
	for _, p in ipairs(partsOf(inst)) do
		local rel = p.Position - pivot
		p.Size = p.Size * factor
		p.CFrame = p.CFrame - p.Position + pivot + rel * factor
		n += 1
		if n % 50 == 0 then
			api.yield()
		end
	end
	local after = T.boundingBox(inst) :: any
	return { ok = true, parts = n, factor = factor, size_after = v3(after.size) }
end

-- align: line `items` up on `axis` using min / center / max of their boxes, relative to the FIRST item
function T.align(items: { any }, axis: string, mode: string): any
	local ax = string.upper(axis)
	if (ax ~= "X" and ax ~= "Y" and ax ~= "Z") or (mode ~= "min" and mode ~= "center" and mode ~= "max") then
		return { ok = false, error = "axis X|Y|Z, mode min|center|max" }
	end
	if #items < 2 then
		return { ok = false, error = "align needs at least 2 items" }
	end
	local function ref(b: any): number
		return mode == "min" and (b.min :: any)[ax] or mode == "max" and (b.max :: any)[ax] or (b.center :: any)[ax]
	end
	local first = T.boundingBox(items[1])
	if not first then
		return { ok = false, error = "first item has no parts" }
	end
	local target = ref(first)
	for i = 2, #items do
		local b = T.boundingBox(items[i])
		if b then
			local d = target - ref(b)
			movePartsBy(items[i], Vector3.new(ax == "X" and d or 0, ax == "Y" and d or 0, ax == "Z" and d or 0))
		end
	end
	return { ok = true, aligned = #items, axis = ax, mode = mode }
end

-- distribute: even spacing between centers along `axis`, keeping the first and last where they are
function T.distribute(items: { any }, axis: string): any
	local ax = string.upper(axis)
	if ax ~= "X" and ax ~= "Y" and ax ~= "Z" then
		return { ok = false, error = "axis must be X, Y or Z" }
	end
	if #items < 3 then
		return { ok = false, error = "distribute needs at least 3 items" }
	end
	local sorted = {}
	for _, it in ipairs(items) do
		local b = T.boundingBox(it)
		if b then
			table.insert(sorted, { inst = it, c = (b.center :: any)[ax] })
		end
	end
	table.sort(sorted, function(a, b)
		return a.c < b.c
	end)
	local lo, hi = sorted[1].c, sorted[#sorted].c
	for i = 2, #sorted - 1 do
		local want = lo + (hi - lo) * (i - 1) / (#sorted - 1)
		local d = want - sorted[i].c
		movePartsBy(sorted[i].inst, Vector3.new(ax == "X" and d or 0, ax == "Y" and d or 0, ax == "Z" and d or 0))
	end
	return { ok = true, distributed = #sorted, spacing = r2((hi - lo) / (#sorted - 1)) }
end

-- snap_to_ground: raycast straight down from above each item's center; rest its LOWEST point on the hit.
-- Returns per-item results; items that hit nothing are reported and left untouched (never silently moved).
function T.snapToGround(items: { any }, api: Api, offset: number?, maxHeight: number?): any
	local results, snapped, missed = {}, 0, 0
	local up = maxHeight or 200
	for _, it in ipairs(items) do
		local b = T.boundingBox(it)
		if not b then
			table.insert(results, { name = it.Name, ok = false, error = "no parts" })
			missed += 1
		else
			local origin = Vector3.new(b.center.X, b.max.Y + up, b.center.Z)
			local hit = api.raycast(origin, Vector3.new(0, -(up + 2000), 0), { it })
			if not hit then
				table.insert(results, { name = it.Name, ok = false, error = "nothing below to land on" })
				missed += 1
			else
				local dy = (hit.position.Y + (offset or 0)) - b.min.Y
				movePartsBy(it, Vector3.new(0, dy, 0))
				snapped += 1
				table.insert(results, { name = it.Name, ok = true, moved_y = r2(dy), landed_on = hit.instance and hit.instance.Name or "?", ground_y = r2(hit.position.Y) })
			end
		end
		if (snapped + missed) % 25 == 0 then
			api.yield()
		end
	end
	return { ok = true, snapped = snapped, missed = missed, results = results }
end

-- find_empty_space: scan a grid of candidate centers; a spot is free if the box there overlaps none of `existing`'s boxes
function T.findEmptySpace(size: Vector3, area: { min: Vector3, max: Vector3 }, existing: { any }, step: number?, y: number?): any
	local boxes = {}
	for _, e in ipairs(existing) do
		local b = T.boundingBox(e)
		if b then
			table.insert(boxes, b)
		end
	end
	local s = step or math.max(size.X, size.Z)
	local found = {}
	local x = area.min.X + size.X / 2
	while x <= area.max.X - size.X / 2 do
		local z = area.min.Z + size.Z / 2
		while z <= area.max.Z - size.Z / 2 do
			local free = true
			for _, b in ipairs(boxes) do
				if math.abs(x - b.center.X) < (size.X + b.size.X) / 2 and math.abs(z - b.center.Z) < (size.Z + b.size.Z) / 2 then
					free = false
					break
				end
			end
			if free then
				table.insert(found, { r2(x), r2(y or area.min.Y), r2(z) })
				if #found >= 20 then
					return { ok = true, spots = found, checked_boxes = #boxes }
				end
			end
			z += s
		end
		x += s
	end
	return { ok = #found > 0, spots = found, checked_boxes = #boxes, error = #found == 0 and "no free space of that size in the area" or nil }
end

return T
