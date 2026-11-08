// A symlink inside /tmp or the project must not be a way out of the sandbox for vm_read_file / vm_write_file. REAL filesystem, no mocks.
import test from "node:test"; import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { vmRead, vmWrite, vmRealPath } from "../src/tools.js";

const D = "/tmp/blk_p2_symlink";
test("symlink: reads and writes through links that leave the sandbox are refused; normal files still work", async () => {
  rmSync(D, { recursive: true, force: true }); mkdirSync(D, { recursive: true });
  writeFileSync(D + "/ok.txt", "hello");
  symlinkSync("/etc/hostname", D + "/file_link");      // file link pointing outside
  symlinkSync("/etc", D + "/dir_link");                // directory link pointing outside
  const r = await vmRead(D + "/ok.txt"); assert.equal(r.ok, true); assert.equal(r.result.content, "hello");
  await assert.rejects(() => vmRead(D + "/file_link"), /outside/);
  await assert.rejects(() => vmRead(D + "/dir_link/hostname"), /outside/);
  await assert.rejects(() => vmWrite(D + "/dir_link/evil.txt", "x"), /outside/);
  assert.equal(existsSync("/etc/evil.txt"), false);
  const w = await vmWrite(D + "/new/sub/file.txt", "data"); assert.equal(w.ok, true); assert.equal(w.result.verified, true);   // a not-yet-existing path under /tmp is fine
  await assert.rejects(() => vmRealPath("/etc/passwd"), /must be inside/);                                                   // the old text check still applies
  rmSync(D, { recursive: true, force: true });
});
