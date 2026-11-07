--!strict
-- Server-authoritative shop. The client only asks "buy item X"; price and ownership are decided here.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local Services = ServerScriptService:WaitForChild("Services")
local DataService = require(Services:WaitForChild("DataService")) :: any
local RemoteGuard = require(Services:WaitForChild("RemoteGuard")) :: any

local ShopService = {}

local CATALOG: { [string]: number } = {
	Sword = 50,
	Shield = 80,
	Potion = 20,
}

function ShopService.Init(_self: any)
	local remotes = ReplicatedStorage:WaitForChild("Remotes")
	local buy = remotes:WaitForChild("BuyItem") :: RemoteFunction
	buy.OnServerInvoke = function(player: Player, itemId: any)
		if not RemoteGuard.rateLimit(player, "BuyItem", 4) then
			return { ok = false, reason = "slow down" }
		end
		if not RemoteGuard.isString(itemId, 40) then
			return { ok = false, reason = "bad item" }
		end
		local price = CATALOG[itemId :: string]
		if not price then
			return { ok = false, reason = "unknown item" }
		end
		local profile = DataService.Get(player)
		if not profile then
			return { ok = false, reason = "data not loaded" }
		end
		if table.find(profile.Inventory, itemId) then
			return { ok = false, reason = "already owned" }
		end
		if profile.Coins < price then
			return { ok = false, reason = "not enough coins" }
		end
		profile.Coins -= price
		table.insert(profile.Inventory, itemId :: string)
		return { ok = true, coins = profile.Coins, item = itemId }
	end
end

return ShopService
