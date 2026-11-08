#!/usr/bin/env bash
# Re-checks the security findings against the LIVE site. Usage: bash scripts/verify-security.sh [https://site]
# Exit code 1 if any check fails. Needs only curl + python3.
SITE="${1:-https://blockyai.onrender.com}"; FAIL=0
H=$(curl -sI "$SITE/")
chk() { if echo "$H" | grep -qiE "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; FAIL=1; fi; }
chk "Content-Security-Policy present"            "^content-security-policy:.*default-src 'none'"
chk "CSP blocks framing (frame-ancestors none)"  "^content-security-policy:.*frame-ancestors 'none'"
chk "CSP has no 'unsafe-inline' for scripts"     "^content-security-policy:.*script-src 'self';"
chk "X-Frame-Options: DENY"                      "^x-frame-options: DENY"
chk "Cross-Origin-Opener-Policy: same-origin"    "^cross-origin-opener-policy: same-origin"
chk "Cross-Origin-Resource-Policy: same-origin"  "^cross-origin-resource-policy: same-origin"
chk "Referrer-Policy"                            "^referrer-policy: strict-origin-when-cross-origin"
chk "Permissions-Policy"                         "^permissions-policy:.*camera=\(\)"
chk "X-Content-Type-Options: nosniff"            "^x-content-type-options: nosniff"
chk "Strict-Transport-Security"                  "^strict-transport-security:.*max-age="
if echo "$H" | grep -qi "script-src[^;]*unsafe-inline"; then echo "FAIL  scripts allow unsafe-inline"; FAIL=1; fi
# SRI: no external script or stylesheet left to need an integrity hash
EXT=$(curl -s "$SITE/" | grep -oE '(src|href)="https?://[^"]+"' | grep -vE 'rel="(icon)"' | head -3)
JS=$(curl -s "$SITE/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.(js|css)' | head -2 | while read f; do curl -s "$SITE/$f" | grep -oE "(googleapis|gstatic)\.com" | head -1; done)
if [ -z "$EXT" ] && [ -z "$JS" ]; then echo "PASS  no external scripts/styles (nothing needs SRI)"; else echo "FAIL  external resources: $EXT $JS"; FAIL=1; fi
# Supabase signup closed
if [ -n "$SUPABASE_ANON_KEY" ]; then c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://sqiruowyfjoctskogzjw.supabase.co/auth/v1/signup" -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}'); [ "$c" = "422" ] || [ "$c" = "400" ] && echo "PASS  Supabase open signup refused ($c)" || { echo "FAIL  Supabase signup returned $c"; FAIL=1; }; fi
exit $FAIL
