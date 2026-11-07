# Building guide: build like a modeler, not a single-block placer

An empty Model, or a model with a handful of parts, is a FAILURE. The server rejects it. Aim for a recognisable object.

## Paths
Use service names directly: `Workspace.Yacht`, `ServerScriptService`, `ReplicatedStorage.Remotes`, `StarterGui`. `game.` and `Game.` prefixes also work, but never invent a parent called "Game" for a new Folder. Services already exist: create things INSIDE them.

## Order of work (always)
1. `plan_create` with a numbered checklist and `target_path` (for example "Workspace.Yacht"). The last items must be verification.
2. Silhouette: the main body, correct overall size.
3. Structure: decks, walls, floors, roof, supports.
4. Details: windows, doors, railings, stairs, lights, signs.
5. Materials and colors, then lighting.
6. Verify: `screenshot_multi` (front, side, top, three_quarter). Fix floating parts, gaps, wrong scale, overlaps. Repeat.
7. `plan_update` with verified:true only after you really looked.

## Real proportions (studs)
- A Roblox character is about 5 studs tall, 2 wide. A door is about 7 tall and 4 wide. A ceiling is 10-12. A stair step is about 1 tall by 2 deep.
- A yacht: 15-25 wide, 60-100 long. A car: about 6 wide, 14 long, 5 tall. A house: 30-50 wide, 25-40 deep, 14-22 tall. A tree: 15-40 tall with a 1.5-3 stud trunk.
- Scale everything from those numbers. Never guess a size you can compute.

## Part budget
- A decent model uses 20-150 parts. Use more only when it adds detail you can see.
- Use plain Parts and WedgeParts first. MeshParts cannot be created from a spec (the mesh id is read-only for plugins), so use `insert_asset` for meshes.
- Unions (CSG) are NOT supported by build_model. Fake a cut-out with several parts around the gap, for example four wall slabs around a window opening.

## Spec rules (what build_model actually accepts)
- Each node: `name`, `class`, then `size [x,y,z]`, `position [x,y,z]`, `rotation [x,y,z]` in degrees, `color "#RRGGBB"`, `material` (short name like Metal, Wood, Glass, Neon, Concrete, SmoothPlastic), `transparency`, `reflectance`, `anchored`, `canCollide`, `shape` (Block/Ball/Cylinder for Part), `attributes`, `tags`, `properties`, `children`.
- Positions are RELATIVE to the parent Model's origin. A sub-Model with a `position` moves all its children.
- Root: set `primary_part` to the name of a main part, and `weld: true` if parts are unanchored. Decorative models stay anchored.
- Scripts: `{ "class": "Script", "name": "DoorScript", "source": "..." }`. A script over 30 lines must be linted first with `vm_lint_luau`.
- Group sub-assemblies into named Models: Hull, Deck, Cabin, Railings, Lights. Name every part clearly.
- Colors and positions use the formats above only. Do not send {r,g,b} tables unless a tool says it accepts them.

## Avoid these mistakes
- Z-fighting: when two faces overlap, offset one by 0.02-0.05 studs.
- Floating parts: check `get_bounding_box` and `measure_distance`. A gap of 0 or less between touching parts is correct; a positive gap you did not intend is a bug.
- One giant block: split it into floor, walls, roof.
- Rainbow palettes: pick 3-5 matching colors and 1 accent (often Neon).

## Compute, do not guess
When the shape is curved or repetitive (hull curve, circle of columns, spiral stairs, castle crenellations, a heightmap): write a short script in the VM with `vm_write_file` and `vm_exec`, print JSON, and build the spec from the REAL output. Example: a ring of N pillars is `x = r*cos(2*pi*i/N), z = r*sin(2*pi*i/N)`.

## Placing things in the world
- `get_bounding_box` before placing next to something. `find_empty_space` to find a free spot. `snap_to_ground` for trees, rocks, props (a miss is reported, not moved).
- `duplicate_grid` / `duplicate_array` / `duplicate_along_path` for fences, rows of trees, street lamps. `mirror` for symmetric halves (positions reflect; rotate wedges yourself).
- Save a good model with `template_save`, reuse it with `build_from_template` (name, position, color overrides).

## Verifying (do not skip)
- `screenshot_multi` gives real viewport images only if the user allowed screenshots in Studio. If it reports `captured: 0`, say so, and fall back to `roblox_screenshot` (a text scene report) plus `get_bounding_box` and `measure_distance` checks. Never claim you saw it when you did not.
- Look from front, side, top, and a three-quarter angle. Compare against the checklist.
