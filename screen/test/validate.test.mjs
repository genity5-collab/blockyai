import test from "node:test"; import assert from "node:assert/strict";
import { cleanKey, clampXY, click, typeText, pressKey, scroll, openUrl, W, H } from "../screen.js";

const INJECT = "; touch /tmp/pwned";   // stands for any attempt to turn text into a shell command

test("keys: real keys pass and are normalised", () => {
  for (const [i, o] of [["Return", "Return"], ["Enter", "Return"], ["Esc", "Escape"], ["Tab", "Tab"], ["ctrl+l", "ctrl+l"], ["Control+a", "ctrl+a"], ["ctrl+shift+Tab", "ctrl+shift+Tab"], ["Page_Down", "Page_Down"], ["F5", "F5"], ["a", "a"], ["7", "7"], ["space", "space"], ["BackSpace", "BackSpace"]])
    assert.equal(cleanKey(i), o, i);
});

test("keys: anything that could be a command, or a dangerous key, is refused", () => {
  for (const bad of ["", null, undefined, "ctrl+alt+Delete", "XF86PowerOff", INJECT, "a b", "ctrl+", "$(id)", "`id`", "Return;ls", "ctrl+alt+F1", "F13", "F0", "super+l", "Meta+l", "super+l\n", "Return\nReturn", "../../x", {}, [], 5, "ctrl+alt+BackSpace"])
    assert.equal(cleanKey(bad), null, "must refuse: " + JSON.stringify(bad));
});

test("coordinates are clamped inside the screen and junk is refused", () => {
  assert.deepEqual(clampXY(10.4, 20.6), [10, 21]);
  assert.deepEqual(clampXY(-50, 99999), [0, H - 1]);
  assert.deepEqual(clampXY(W + 500, 5), [W - 1, 5]);
  assert.deepEqual(clampXY("640", "400"), [640, 400]);
  for (const [x, y] of [[NaN, 1], [1, undefined], ["abc", 5], [Infinity, 1], [1, -Infinity]]) assert.equal(clampXY(x, y), null, JSON.stringify([x, y]));
});

test("bad calls are refused BEFORE any program runs (no display needed)", async () => {
  assert.equal((await click({ x: "a", y: 1 })).ok, false);
  assert.equal((await click({})).ok, false);
  assert.equal((await typeText({ text: "" })).ok, false);
  assert.equal((await typeText({ text: "x".repeat(2001) })).ok, false);
  assert.equal((await typeText({})).ok, false);
  assert.equal((await pressKey({ key: INJECT })).ok, false);
  assert.equal((await pressKey({})).ok, false);
  assert.equal((await scroll({ direction: "sideways" })).ok, false);
  for (const u of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "data:text/html,x", "not a url", "", "ftp://x.com/a", "view-source:https://a.com"])
    assert.equal((await openUrl({ url: u })).ok, false, u);
});

test("no shell is ever used, and typed text goes after '--' as ONE argument", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = (await readFile(new URL("../screen.js", import.meta.url), "utf8")).replace(/\/\/.*$/gm, "");
  assert.ok(!/\bexec\(|execSync|spawn\(\s*["'`]sh|\bsh -c|bash -c|shell:\s*true/.test(src), "no shell");
  assert.ok(/"type", "--delay", "12", "--clearmodifiers", "--", t/.test(src), "typed text goes after --");
});
