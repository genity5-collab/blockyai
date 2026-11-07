# Reference specs

Example `build_model` specs the agent can read with `vm_read_file` and adapt. Each is valid JSON using only features the plugin supports.
Sizes are in studs. Positions are relative to the model origin. They are STARTING POINTS: change sizes, colors and details for the request.

Files: house, car, boat, tree, tower, castle, spaceship. Run `node validate.mjs` to check every file parses and has the structure build_model needs.
