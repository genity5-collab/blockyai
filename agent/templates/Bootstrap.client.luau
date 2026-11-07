--!strict
-- Single client bootstrap: requires every controller in PlayerScripts.Controllers.
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local playerScripts = player:WaitForChild("PlayerScripts")
local controllers = playerScripts:WaitForChild("Controllers")

for _, module in controllers:GetChildren() do
	if module:IsA("ModuleScript") then
		local ok, controller = pcall(require, module)
		if ok and type(controller) == "table" and type((controller :: any).Start) == "function" then
			task.spawn((controller :: any).Start, controller)
		elseif not ok then
			warn(`[Client] {module.Name} failed: {controller}`)
		end
	end
end
