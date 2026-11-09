// REAL display test: a virtual X display, a window manager and a terminal window; screen.js does a real click, real typing and a real capture.
// This proves the mouse/keyboard/capture path of the AI's screen. It does NOT involve Chrome (that is proven by the bake self-check on the VM).
// It never touches a display that already exists (a live VM's screen runs on :0), and skips with a clear reason when X tools are missing.
import test from "node:test"; import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process"; import { writeFileSync, rmSync } from "node:fs";
const clearLocks = () => { rmSync("/tmp/.X0-lock", { force: true }); rmSync("/tmp/.X11-unix/X0", { force: true }); };   // a killed Xvfb leaves these behind and the next start would refuse
import * as S from "../screen.js";

const has = (c) => { try { execFileSync("sh", ["-c", `command -v ${c}`], { stdio: "ignore" }); return true; } catch { return false; } };
const displayExists = () => { try { execFileSync("xdpyinfo", ["-display", ":0"], { stdio: "ignore" }); return true; } catch { return false; } };
const missing = ["Xvfb", "openbox", "xterm", "xdotool", "import", "xdpyinfo"].filter((c) => !has(c));
const skip = missing.length ? "missing X tools: " + missing.join(", ") : (displayExists() ? "a display already exists on :0 (a live screen): not touching it" : false);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("real X display: capture, click, type and key press change what is on screen", { skip, timeout: 60000 }, async () => {
  const procs = [];
  const start = (cmd, args) => { const p = spawn(cmd, args, { env: { ...process.env, DISPLAY: ":0" }, stdio: "ignore" }); procs.push(p); return p; };
  try {
    clearLocks();                                   // only reached when no display answers on :0 (see skip above), so these can only be stale
    start("Xvfb", [":0", "-screen", "0", "1280x800x24", "-nolisten", "tcp"]);
    for (let i = 0; i < 40 && !displayExists(); i++) await wait(250);
    assert.ok(displayExists(), "Xvfb came up");
    start("openbox", []); await wait(600);
    start("xterm", ["-geometry", "80x24+100+100", "-fa", "Monospace", "-fs", "14", "-bg", "black", "-fg", "white", "-e", "bash", "--norc", "-i"]); await wait(1500);

    const a = await S.shot(); assert.equal(a.ok, true, JSON.stringify(a).slice(0, 200));
    assert.equal(a.bytes[0], 0xff); assert.equal(a.bytes[1], 0xd8, "a real JPEG");
    const dim = execFileSync("identify", ["-format", "%wx%h", "/tmp/screen-" + process.pid + ".jpg"]).toString(); assert.equal(dim, "1280x800");

    assert.equal((await S.click({ x: 300, y: 200 })).ok, true);                         // focus the terminal window
    const t = await S.typeText({ text: "echo BLOCKYAI_REAL_SCREEN_TEST && ls /" }); assert.equal(t.ok, true); assert.equal(t.typed, 38);
    assert.equal((await S.pressKey({ key: "Return" })).ok, true); await wait(800);
    const b = await S.shot(); assert.equal(b.ok, true);
    assert.notEqual(a.base64, b.base64, "the picture changed after real typing");
    // How much changed: count differing pixels with ImageMagick. A real typed line changes many pixels; an unchanged screen changes none.
    writeFileSync("/tmp/x11a.jpg", a.bytes); writeFileSync("/tmp/x11b.jpg", b.bytes);
    const out = (() => { try { execFileSync("compare", ["-metric", "AE", "/tmp/x11a.jpg", "/tmp/x11b.jpg", "/dev/null"], { stdio: ["ignore", "ignore", "pipe"] }); return ""; } catch (e) { return String(e.stderr ?? ""); } })();
    const changed = Number(out.trim().split(/\s+/)[0]); assert.ok(Number.isFinite(changed) && changed > 200, "typing really changed the screen: " + out);
    rmSync("/tmp/x11a.jpg", { force: true }); rmSync("/tmp/x11b.jpg", { force: true });

    const scroll = await S.scroll({ direction: "down", amount: 3 }); assert.equal(scroll.ok, true);
    assert.equal((await S.click({ x: 5000, y: -4 })).ok, true, "out-of-range coordinates are clamped, not an error");
    assert.equal((await S.pressKey({ key: "ctrl+alt+Delete" })).ok, false, "reserved shortcuts are refused before xdotool sees them");
    assert.equal((await S.typeText({ text: "" })).ok, false);
  } finally { for (const p of procs.reverse()) { try { p.kill("SIGTERM"); } catch {} } await wait(500); for (const p of procs) { try { p.kill("SIGKILL"); } catch {} } await wait(200); clearLocks(); }
});
