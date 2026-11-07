--!strict
-- Obby checkpoints + leaderstats Stage value. A checkpoint is any Part named "Checkpoint_<n>" in Workspace.Checkpoints.
local Players = game:GetService("Players")

local Checkpoints = {}

local reached: { [Player]: number } = {}

local function setStage(player: Player, stage: number)
	local stats = player:FindFirstChild("leaderstats")
	local value = stats and stats:FindFirstChild("Stage")
	if value and value:IsA("IntValue") and stage > value.Value then
		value.Value = stage
	end
end

function Checkpoints.Init(_self: any)
	Players.PlayerAdded:Connect(function(player)
		local stats = Instance.new("Folder")
		stats.Name = "leaderstats"
		local stage = Instance.new("IntValue")
		stage.Name = "Stage"
		stage.Value = 1
		stage.Parent = stats
		stats.Parent = player
		reached[player] = 1
		player.CharacterAdded:Connect(function(character)
			local spawnPart = workspace:FindFirstChild("Checkpoints")
			local target = spawnPart and spawnPart:FindFirstChild("Checkpoint_" .. tostring(reached[player]))
			local root = character:WaitForChild("HumanoidRootPart", 5)
			if target and target:IsA("BasePart") and root and root:IsA("BasePart") then
				root.CFrame = target.CFrame + Vector3.new(0, 4, 0)
			end
		end)
	end)
	Players.PlayerRemoving:Connect(function(player)
		reached[player] = nil
	end)
end

function Checkpoints.Start(_self: any)
	local folder = workspace:WaitForChild("Checkpoints", 10)
	if not folder then
		warn("[Checkpoints] no Workspace.Checkpoints folder")
		return
	end
	for _, part in folder:GetChildren() do
		local n = tonumber(string.match(part.Name, "^Checkpoint_(%d+)$"))
		if n and part:IsA("BasePart") then
			part.Touched:Connect(function(hit)
				local character = hit.Parent
				local player = if character and character:IsA("Model") then Players:GetPlayerFromCharacter(character) else nil
				if player and n > (reached[player] or 1) then
					reached[player] = n
					setStage(player, n)
				end
			end)
		end
	end
end

return Checkpoints
