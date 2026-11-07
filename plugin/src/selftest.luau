--!strict
-- BlockyAI in-Studio self-test. No AI is involved: the plugin exercises its own handlers against the real engine and reports pass/fail
-- with the RAW error for each step. This file holds the RUNNER (ordering, pcall wrapping, cleanup, reporting) and the step LIST.
-- The runner is unit tested with a fake engine. Whether each step passes in a real Studio can only be learned by pressing the button.
local S = {}

export type Step = { name: string, run: (ctx: any) -> any, optional: boolean?, requires: string? }
export type StepResult = { name: string, status: string, error: string?, detail: any?, ms: number }
export type Report = { passed: number, failed: number, skipped: number, steps: { StepResult }, cleaned: boolean, cleanup_error: string? }

-- status is one of: pass, fail, skip (a required feature is missing), fallback (worked, but via the documented fallback)
function S.run(steps: { Step }, ctx: any, features: { [string]: boolean }?, clock: (() -> number)?): Report
	local now = clock or os.clock
	local report: Report = { passed = 0, failed = 0, skipped = 0, steps = {}, cleaned = false }
	for _, step in ipairs(steps) do
		local t0 = now()
		local r: StepResult = { name = step.name, status = "pass", ms = 0 }
		if step.requires and features and features[step.requires] == false then
			r.status = "skip"
			r.error = "this Studio does not have " .. step.requires
			report.skipped += 1
		else
			local ok, res = pcall(step.run, ctx)
			if ok then
				if type(res) == "table" and (res :: any).fallback == true then
					r.status = "fallback"
				end
				r.detail = res
				report.passed += 1
			else
				r.status = "fail"
				r.error = tostring(res)
				report.failed += 1
			end
		end
		r.ms = math.floor((now() - t0) * 1000)
		table.insert(report.steps, r)
	end
	-- Cleanup ALWAYS runs, even when steps failed, and a failing cleanup is reported rather than hidden.
	local cok, cerr = true, nil :: any
	if ctx and ctx.cleanup then
		cok, cerr = pcall(ctx.cleanup)
	end
	report.cleaned = cok
	if not cok then
		report.cleanup_error = tostring(cerr)
	end
	return report
end

-- The fixed list. Each step receives `ctx`, which exposes the plugin's real handlers and a tracker so cleanup can remove what was made.
-- `ctx.h` = handlers table, `ctx.http(fn, body)` = POST to the server, `ctx.track(path)` = remember an instance path for cleanup.
function S.steps(): { Step }
	local function must(cond: any, msg: string)
		if not cond then
			error(msg, 0)
		end
	end
	return {
		{ name = "HTTP reachability", run = function(ctx)
			local data, code = ctx.http("plugin-register", { version = 0 })
			must(code == 200 and data ~= nil, "plugin-register returned " .. tostring(code))
			return { status = code }
		end },
		{ name = "build_model: kitchen-sink spec", run = function(ctx)
			local r = ctx.h.build_model({ parent = ctx.root, spec = ctx.kitchenSink })
			must(r and (r.errors == nil or #r.errors == 0), "build_model reported errors: " .. ctx.encode(r and r.errors or "no result"))
			must((r.instances or 0) >= 10, "expected 10 or more instances, got " .. tostring(r and r.instances))
			ctx.track(ctx.root .. ".SelfTestModel")
			return { instances = r.instances }
		end },
		{ name = "script write + read-back", run = function(ctx)
			local src = "print('blockyai selftest ' .. 1 + 1)\n"
			ctx.h.write_script({ path = ctx.root .. ".SelfTestScript", class = "Script", source = src })
			ctx.track(ctx.root .. ".SelfTestScript")
			local back = ctx.h.read_script({ path = ctx.root .. ".SelfTestScript" })
			must(back and back.source == src, "read-back differs from what was written")
			return { bytes = #src }
		end },
		{ name = "ui_build", run = function(ctx)
			local r = ctx.h.ui_build({ parent = ctx.root, spec = ctx.uiSpec })
			must(r and (r.errors == nil or #r.errors == 0), "ui_build reported errors: " .. ctx.encode(r and r.errors or "no result"))
			ctx.track(ctx.root .. ".SelfTestGui")
			return { instances = r.instances }
		end },
		{ name = "terrain_heightmap 16x16", requires = "Terrain.WriteVoxels", run = function(ctx)
			local heights = {}
			for z = 1, 16 do
				heights[z] = {}
				for x = 1, 16 do
					heights[z][x] = 4 + (x + z) % 3
				end
			end
			local r = ctx.h.terrain_heightmap({ heights = heights, origin = { 0, 0, 0 }, cell = 4, material = "Grass" })
			must(r and (r.ok ~= false), "terrain_heightmap failed: " .. ctx.encode(r))
			ctx.clearTerrain()
			return r
		end },
		{ name = "lighting_set", run = function(ctx)
			-- uses the real parameters: { lighting = {Property = value}, time_of_day = hours }. The original values are saved and put back.
			local saved = ctx.saveLighting()
			local r = ctx.h.lighting_set({ lighting = { Brightness = 3 }, time_of_day = 14 })
			must(r ~= nil, "no result")
			local failed = {}
			for _, c in ipairs(r.changed or {}) do
				if string.find(tostring(c), "FAILED", 1, true) then
					table.insert(failed, tostring(c))
				end
			end
			ctx.restoreLighting(saved)
			must(#failed == 0, "some lighting properties were rejected: " .. table.concat(failed, "; "))
			return { changed = r.changed }
		end },
		{ name = "camera_set", run = function(ctx)
			return ctx.h.camera_set({ position = { 20, 20, 20 }, look_at = { 0, 0, 0 } })
		end },
		{ name = "screenshot (reports the fallback honestly)", run = function(ctx)
			local r = ctx.h.screenshot({})
			must(r ~= nil, "no result")
			-- A scene report instead of pixels is a fallback, not a failure, and must be labelled as such.
			if r.scene_report ~= nil or r.png_b64 == nil then
				return { fallback = true, kind = "scene report (no pixels)" }
			end
			return { kind = "png", bytes = #r.png_b64 }
		end },
		{ name = "snapshot save + restore + compare", run = function(ctx)
			local before = ctx.countDescendants()
			local snap = ctx.h.snapshot_save({ label = "selftest" })
			ctx.h.create({ parent = ctx.root, class = "Part", name = "SelfTestExtra" })
			local mutated = ctx.countDescendants()
			must(mutated > before, "mutation did not change the tree (cannot test restore)")
			ctx.h.snapshot_restore({ id = snap.id })
			local after = ctx.countDescendants()
			must(after == before, ("restore did not return to the saved state: before=%d, after restore=%d"):format(before, after))
			return { before = before, mutated = mutated, after = after }
		end },
		{ name = "playtest start/stop with a print script and log read", requires = "StudioTestService", run = function(ctx)
			ctx.h.write_script({ path = "ServerScriptService.__BlockyAISelfTestPrint", class = "Script", source = "print('SELFTEST_MARKER_42')\n" })
			ctx.track("ServerScriptService.__BlockyAISelfTestPrint")
			local s = ctx.h.playtest_start({ mode = "run", seconds = 4 })
			must(s and s.started, "playtest_start did not start")
			ctx.wait(6)
			local logs = ctx.h.get_playtest_logs({})
			ctx.h.playtest_stop({})
			must(logs ~= nil, "no logs returned")
			must(ctx.encode(logs):find("SELFTEST_MARKER_42", 1, true) ~= nil, "the marker line was not found in the playtest logs")
			return { log_lines = #(logs.lines or logs) }
		end },
		{ name = "ChangeHistory undo", run = function(ctx)
			local before = ctx.countDescendants()
			ctx.h.create({ parent = ctx.root, class = "Part", name = "SelfTestUndo" })
			ctx.undo()
			local after = ctx.countDescendants()
			must(after == before, ("undo did not revert the create: before=%d after=%d"):format(before, after))
			return { before = before, after = after }
		end },
	}
end

return S
