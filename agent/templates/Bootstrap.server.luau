--!strict
-- Single server bootstrap: loads every module in ServerScriptService.Services and calls Init, then Start.
local ServerScriptService = game:GetService("ServerScriptService")

local servicesFolder = ServerScriptService:WaitForChild("Services")

type Service = {
	Init: ((Service) -> ())?,
	Start: ((Service) -> ())?,
}

local loaded: { [string]: Service } = {}

for _, module in servicesFolder:GetChildren() do
	if module:IsA("ModuleScript") then
		local ok, result = pcall(require, module)
		if ok then
			loaded[module.Name] = result :: Service
		else
			warn(`[Bootstrap] {module.Name} failed to load: {result}`)
		end
	end
end

for name, service in loaded do
	if service.Init then
		local ok, err = xpcall(function()
			(service.Init :: (Service) -> ())(service)
		end, debug.traceback)
		if not ok then
			warn(`[Bootstrap] {name}.Init failed: {err}`)
		end
	end
end

for name, service in loaded do
	if service.Start then
		task.spawn(function()
			local ok, err = xpcall(function()
				(service.Start :: (Service) -> ())(service)
			end, debug.traceback)
			if not ok then
				warn(`[Bootstrap] {name}.Start failed: {err}`)
			end
		end)
	end
end

print("[Bootstrap] server ready")
