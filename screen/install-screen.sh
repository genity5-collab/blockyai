#!/bin/bash
# Installs the AI's screen on the VM (run once while baking the snapshot). Separate from agent/bootstrap-vm.sh on purpose.
set -ux
export DEBIAN_FRONTEND=noninteractive
{
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends xvfb openbox xdotool imagemagick x11-utils fonts-liberation fonts-noto-color-emoji ca-certificates curl wget dbus-x11 gnupg
echo "STEP deps rc=$?"
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y -qq --no-install-recommends /tmp/chrome.deb
echo "STEP chrome rc=$?"
# Free design and media tools the AI may use with no login: Inkscape (vector art), ImageMagick (already), ffmpeg.
sudo apt-get install -y -qq --no-install-recommends inkscape ffmpeg
echo "STEP tools rc=$?"
} > /tmp/screen-install.log 2>&1
grep -E '^STEP' /tmp/screen-install.log
google-chrome --version
command -v Xvfb openbox xdotool import inkscape ffmpeg >/dev/null && echo "ALL TOOLS PRESENT" || echo "SOME TOOL MISSING"
