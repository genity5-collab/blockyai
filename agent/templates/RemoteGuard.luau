--!strict
-- Server-side remote validation + rate limiting. Never trust a client for currency, damage or inventory.
local RemoteGuard = {}

local buckets: { [Player]: { [string]: { count: number, window: number } } } = {}

function RemoteGuard.rateLimit(player: Player, name: string, maxPerSecond: number): boolean
	local now = os.clock()
	local perPlayer = buckets[player]
	if not perPlayer then
		perPlayer = {}
		buckets[player] = perPlayer
	end
	local b = perPlayer[name]
	if not b or now - b.window >= 1 then
		perPlayer[name] = { count = 1, window = now }
		return true
	end
	b.count += 1
	return b.count <= maxPerSecond
end

function RemoteGuard.isString(v: any, maxLen: number?): boolean
	return type(v) == "string" and #v <= (maxLen or 100)
end

function RemoteGuard.isNumber(v: any, min: number?, max: number?): boolean
	if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then
		return false
	end
	return v >= (min or -1e9) and v <= (max or 1e9)
end

function RemoteGuard.isInt(v: any, min: number?, max: number?): boolean
	return RemoteGuard.isNumber(v, min, max) and math.floor(v) == v
end

function RemoteGuard.cleanup(player: Player)
	buckets[player] = nil
end

return RemoteGuard
