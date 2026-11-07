-- Same algorithm as resolve() in src/main.luau, run against a fake DataModel. Keep the two in sync.
local function node(name: string, children: { any }?): any
	local n: any = { Name = name, kids = children or {} }
	function n:FindFirstChild(x: string) for _, k in ipairs(self.kids) do if k.Name == x then return k end end return nil end
	return n
end
local ws, sss, rs = node("Workspace", { node("Yacht", { node("Hull") }) }), node("ServerScriptService"), node("ReplicatedStorage")
local game_: any = node("Game", { ws, sss, rs })
function game_:GetService(n: string) local f = self:FindFirstChild(n); if not f then error("no service " .. n) end return f end
local function resolve(path: string): any
	local cur: any = game_
	local first = true
	for part in string.gmatch(path, "[^%./]+") do
		if first and (string.lower(part) == "game" or part == "DataModel") then first = false; continue end
		first = false
		local nxt = cur:FindFirstChild(part)
		if not nxt and cur == game_ then
			local okSvc, svc = pcall(function() return game_:GetService(part) end)
			if okSvc then nxt = svc end
		end
		if not nxt then return nil end
		cur = nxt
	end
	return cur
end
local passed, failed = 0, 0
local function check(n: string, c: boolean) if c then passed += 1 else failed += 1; print("FAIL: " .. n) end end
check("'Game' is the root (the reported failure)", resolve("Game") == game_)
check("'game' is the root", resolve("game") == game_)
check("'Game.ServerScriptService' works", resolve("Game.ServerScriptService") == sss)
check("'game.Workspace.Yacht.Hull' works", resolve("game.Workspace.Yacht.Hull") ~= nil)
check("'Workspace.Yacht' works without a prefix", resolve("Workspace.Yacht") ~= nil)
check("'ReplicatedStorage' alone works", resolve("ReplicatedStorage") == rs)
check("slash paths work", resolve("Workspace/Yacht/Hull") ~= nil)
check("a missing path is nil, not a crash", resolve("Workspace.Nope") == nil and resolve("Game.Nope.Deeper") == nil)
check("'Game' only skipped as the FIRST segment", resolve("Workspace.Game") == nil)
print(string.format("resolve: %d passed, %d failed", passed, failed))
if failed > 0 then error("resolve tests failed") end
