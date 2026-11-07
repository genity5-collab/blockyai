#!/bin/bash
# BlockyAI VM bootstrap: Luau tooling. Idempotent.
set -e
sudo mkdir -p /opt/tools && sudo chown -R ubuntu:ubuntu /opt/tools
cd /opt/tools
dl() { curl -fsSL -o "$1.zip" "$2" && unzip -oq "$1.zip" -d "$1"; }
dl luau   "https://github.com/luau-lang/luau/releases/download/0.745/luau-ubuntu.zip"
dl stylua "https://github.com/JohnnyMorganz/StyLua/releases/download/v2.6.0/stylua-linux-x86_64.zip"
dl selene "https://github.com/Kampfkarren/selene/releases/download/0.32.0/selene-0.32.0-linux.zip"
for b in luau-analyze luau stylua selene; do p=$(find /opt/tools -type f -name "$b" | head -1); [ -n "$p" ] && sudo install -m755 "$p" /usr/local/bin/"$b"; done
echo "--- installed:"; ls /usr/local/bin
