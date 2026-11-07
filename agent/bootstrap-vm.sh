#!/bin/bash
# BlockyAI VM bootstrap. Idempotent. Installs the Luau toolchain and the Roblox type definitions.
set -e
sudo mkdir -p /opt/tools && sudo chown -R ubuntu:ubuntu /opt/tools
cd /opt/tools
dl() { curl -fsSL -m 120 -o "$1.zip" "$2" && unzip -oq "$1.zip" -d "$1"; }
dl luau     "https://github.com/luau-lang/luau/releases/download/0.745/luau-ubuntu.zip"
dl stylua   "https://github.com/JohnnyMorganz/StyLua/releases/download/v2.6.0/stylua-linux-x86_64.zip"
dl selene   "https://github.com/Kampfkarren/selene/releases/download/0.32.0/selene-0.32.0-linux.zip"
dl luau-lsp "https://github.com/JohnnyMorganz/luau-lsp/releases/download/1.70.1/luau-lsp-linux-x86_64.zip"
for b in luau-analyze luau stylua selene luau-lsp; do p=$(find /opt/tools -type f -name "$b" | head -1); [ -n "$p" ] && sudo install -m755 "$p" /usr/local/bin/"$b"; done
# Roblox type definitions. The plain luau-analyze build cannot load them (no --definitions flag), so luau-lsp analyze is the type checker.
mkdir -p /home/ubuntu/project/types /home/ubuntu/project/mirror /home/ubuntu/project/lint
curl -fsSL -m 120 -o /home/ubuntu/project/types/globalTypes.d.luau https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/main/scripts/globalTypes.d.luau
test -s /home/ubuntu/project/types/globalTypes.d.luau || { echo "FAILED: globalTypes.d.luau missing or empty"; exit 1; }
# .luaurc: strict mode by default, matching what the agent's checker uses.
printf '{"languageMode":"strict"}\n' > /home/ubuntu/project/.luaurc
echo "--- installed:"; for b in luau-analyze stylua selene luau-lsp; do printf "%s: " $b; command -v $b >/dev/null && echo ok || echo MISSING; done
echo "types: $(wc -c < /home/ubuntu/project/types/globalTypes.d.luau) bytes"
