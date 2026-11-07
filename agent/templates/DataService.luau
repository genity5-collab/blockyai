--!strict
-- Player data with retries and a session lock. Studio-safe: when API access is off it keeps data in memory and says so.
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local DataService = {}

export type Profile = {
	Coins: number,
	Stage: number,
	Inventory: { string },
}

local DEFAULT: Profile = { Coins = 0, Stage = 1, Inventory = {} }
local STORE_NAME = "PlayerData_v1"
local LOCK_SECONDS = 90
local MAX_TRIES = 5

local store: DataStore? = nil
local profiles: { [number]: Profile } = {}
local usingMemory = false
local jobId = game.JobId ~= "" and game.JobId or "studio"

local function deepCopy<T>(t: T): T
	if type(t) ~= "table" then
		return t
	end
	local out: any = {}
	for k, v in pairs(t :: any) do
		out[k] = deepCopy(v)
	end
	return out
end

local function withRetry<T>(label: string, fn: () -> T): (boolean, T?)
	for attempt = 1, MAX_TRIES do
		local ok, result = pcall(fn)
		if ok then
			return true, result
		end
		warn(`[DataService] {label} failed (try {attempt}/{MAX_TRIES}): {result}`)
		task.wait(math.min(2 ^ attempt, 16))
	end
	return false, nil
end

function DataService.Init(_self: any)
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(STORE_NAME)
	end)
	if ok then
		store = result :: DataStore
	else
		usingMemory = true
		warn("[DataService] DataStores unavailable; using memory only (data will NOT persist). Enable Studio API access to test saving.")
	end
	Players.PlayerAdded:Connect(function(player)
		DataService.Load(player)
	end)
	Players.PlayerRemoving:Connect(function(player)
		DataService.Save(player, true)
	end)
	game:BindToClose(function()
		if RunService:IsStudio() then
			return
		end
		for _, player in Players:GetPlayers() do
			DataService.Save(player, true)
		end
	end)
end

function DataService.Load(player: Player): Profile
	local key = `Player_{player.UserId}`
	local profile: Profile = deepCopy(DEFAULT)
	if store and not usingMemory then
		local ds = store :: DataStore
		local ok, data = withRetry("load " .. key, function()
			return ds:UpdateAsync(key, function(old: any)
				old = old or {}
				local lock = old.Lock
				if lock and lock.JobId ~= jobId and os.time() - lock.Time < LOCK_SECONDS then
					error("session locked by another server")
				end
				old.Lock = { JobId = jobId, Time = os.time() }
				return old
			end)
		end)
		if ok and type(data) == "table" and type((data :: any).Data) == "table" then
			for k, v in pairs((data :: any).Data) do
				(profile :: any)[k] = v
			end
		elseif not ok then
			player:Kick("Your data could not be loaded safely. Please rejoin.")
		end
	end
	profiles[player.UserId] = profile
	return profile
end

function DataService.Get(player: Player): Profile?
	return profiles[player.UserId]
end

function DataService.Save(player: Player, release: boolean?)
	local profile = profiles[player.UserId]
	if not profile or usingMemory or not store then
		profiles[player.UserId] = nil
		return
	end
	local ds = store :: DataStore
	local key = `Player_{player.UserId}`
	withRetry("save " .. key, function()
		return ds:UpdateAsync(key, function(old: any)
			old = old or {}
			old.Data = profile
			old.Lock = if release then nil else { JobId = jobId, Time = os.time() }
			return old
		end)
	end)
	if release then
		profiles[player.UserId] = nil
	end
end

return DataService
