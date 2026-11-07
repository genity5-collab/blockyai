#!/usr/bin/env bash
# Fails if the plugin or website calls /api/<fn> that the Render site does not rewrite to Supabase.
# Needs RENDER_API_KEY. Run from the repo root: bash scripts/check-routes.sh
set -euo pipefail
SERVICE=srv-dbng2p67bikc73cf6ehg
CALLED=$( (grep -ohE '(post|get)\("[a-z-]+"' plugin/src/main.luau | sed -E 's/.*"([a-z-]+)"/\1/'; grep -rohE 'call\("[a-z-]+"' web-src/src | sed -E 's/.*"([a-z-]+)"/\1/'; echo web-api) | sort -u)
ROUTED=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" "https://api.render.com/v1/services/$SERVICE/routes" | python3 -c 'import sys,json;print("\n".join(sorted(r["route"]["source"].replace("/api/","") for r in json.load(sys.stdin))))')
MISSING=$(comm -23 <(echo "$CALLED") <(echo "$ROUTED"))
if [ -n "$MISSING" ]; then echo "NOT ROUTED on the site (add a rewrite /api/<name> -> Supabase function):"; echo "$MISSING" | sed 's/^/  /'; exit 1; fi
echo "ok: all $(echo "$CALLED" | wc -l) called functions are routed"
