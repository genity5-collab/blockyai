#!/bin/bash
# Starts the virtual display, a window manager and Chrome. Safe to run again. The browser debugging port is bound to 127.0.0.1 ONLY: it controls the
# whole browser, so it must never be reachable from outside the VM.
export DISPLAY=:0
pkill -u ubuntu -f "Xvfb :0" 2>/dev/null; pkill -u ubuntu openbox 2>/dev/null; pkill -u ubuntu -f google-chrome 2>/dev/null; sleep 0.5
nohup Xvfb :0 -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for i in $(seq 1 40); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.25; done
nohup openbox >/tmp/openbox.log 2>&1 &
sleep 0.5
mkdir -p /home/ubuntu/chrome-profile
rm -f /home/ubuntu/chrome-profile/Singleton*
nohup google-chrome --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-gpu --disable-extensions --disable-sync \
  --disable-features=Translate,PasswordManagerOnboarding --password-store=basic --disable-save-password-bubble \
  --user-data-dir=/home/ubuntu/chrome-profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --window-size=1280,800 --window-position=0,0 about:blank >/tmp/chrome.log 2>&1 &
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break; sleep 0.25; done
echo started
