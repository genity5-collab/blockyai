-- Builds every reference spec with the REAL builder (mock engine) and checks the geometry is coherent.
local Mock = require("./mock")
local env = setmetatable({}, { __index = _G })
Mock.install(env)
local function load(m: string): any
	local fn = assert(loadstring(require(m) :: string, "@" .. m)); setfenv(fn, env); return fn()
end
local Builder = load("./builder_src")
local T = load("./transform_src")
local specs: { [string]: any } = require("./reference_data")
local passed, failed = 0, 0
local function check(name: string, cond: boolean, detail: any?)
	if cond then passed += 1 else failed += 1; print("FAIL: " .. name .. (detail ~= nil and (" :: " .. tostring(detail)) or "")) end
end
for name, spec in pairs(specs) do
	local r = Builder.build(env.workspace, spec)
	check(name .. " builds", r.ok, r.error)
	if r.ok then
		check(name .. " has no build errors", #r.errors == 0, table.concat(r.errors, " | "))
		check(name .. " has a PrimaryPart", r.primary_part ~= nil)
		-- FLOATING CHECK: every part must touch or overlap at least one other part (gap <= 0.1) or it is floating.
		local parts = T.partsOf(r.instance)
		local floating = {}
		for i, a in ipairs(parts) do
			local touches = false
			for j, b in ipairs(parts) do
				if i ~= j then
					local ba = { min = a.CFrame.Position - a.Size / 2, max = a.CFrame.Position + a.Size / 2 }
					local bb = { min = b.CFrame.Position - b.Size / 2, max = b.CFrame.Position + b.Size / 2 }
					local gx = math.max(ba.min.X - bb.max.X, bb.min.X - ba.max.X)
					local gy = math.max(ba.min.Y - bb.max.Y, bb.min.Y - ba.max.Y)
					local gz = math.max(ba.min.Z - bb.max.Z, bb.min.Z - ba.max.Z)
					if math.max(gx, gy, gz) <= 0.15 then touches = true break end
				end
			end
			if not touches then table.insert(floating, a.Name) end
		end
		check(name .. " has no floating parts", #floating == 0, table.concat(floating, ","))
	end
end
print(string.format("reference: %d passed, %d failed", passed, failed))
if failed > 0 then error("reference tests failed") end
