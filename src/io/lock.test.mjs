import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { acquireDirectoryLock, withDirectoryLock } from "./lock.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-lock-"));
  roots.push(root);
  return path.join(root, "build.lock");
}
it("releases ownership on callback failure", async () => {
  const file = fixture();
  await expect(
    withDirectoryLock(file, () => {
      throw new Error("failure");
    }),
  ).rejects.toThrow("failure");
  expect(fs.existsSync(file)).toBe(false);
});
it("waits for a live owner, regardless of directory age", async () => {
  const file = fixture();
  const first = await acquireDirectoryLock(file);
  fs.utimesSync(file, new Date(0), new Date(0));
  let acquired = false;
  const pending = acquireDirectoryLock(file, { pollIntervalMs: 5 }).then(
    (lock) => {
      acquired = true;
      return lock;
    },
  );
  await delay(30);
  expect(acquired).toBe(false);
  await first.release();
  const second = await pending;
  expect(second.record.ownerId).not.toBe(first.record.ownerId);
  await second.release();
  await first.release();
});
it("recovers a dead owner immediately", async () => {
  const file = fixture();
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await once(child, "exit");
  fs.mkdirSync(file);
  fs.writeFileSync(
    path.join(file, "owner.json"),
    JSON.stringify({
      ownerId: "old",
      pid: child.pid,
      acquiredAtMs: Date.now(),
    }),
  );
  const lock = await acquireDirectoryLock(file);
  expect(lock.record.ownerId).not.toBe("old");
  await lock.release();
});
it("recovers an aged directory whose owner metadata was never written", async () => {
  const file = fixture();
  fs.mkdirSync(file);
  fs.utimesSync(file, new Date(0), new Date(0));
  const lock = await acquireDirectoryLock(file, { staleAfterMs: 10 });
  await lock.release();
});
it("does not recursively delete unexpected lock contents", async () => {
  const file = fixture();
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, "unrelated.txt"), "preserve");
  fs.utimesSync(file, new Date(0), new Date(0));
  await expect(
    acquireDirectoryLock(file, { staleAfterMs: 10 }),
  ).rejects.toThrow(/unexpected/i);
  expect(fs.readFileSync(path.join(file, "unrelated.txt"), "utf8")).toBe(
    "preserve",
  );
});
it("does not automatically unlink an abandoned coordination guard", async () => {
  const file = fixture();
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await once(child, "exit");
  fs.writeFileSync(
    `${file}.guard`,
    JSON.stringify({ ownerId: "dead-guard", pid: child.pid }),
  );
  await expect(acquireDirectoryLock(file)).rejects.toThrow(
    /coordination guard.*manual/i,
  );
  expect(fs.existsSync(`${file}.guard`)).toBe(true);
});
it("refuses a symlink at the lock rather than deleting its target", async () => {
  const file = fixture();
  const target = path.join(path.dirname(file), "target");
  fs.mkdirSync(target);
  fs.symlinkSync(target, file);
  await expect(acquireDirectoryLock(file)).rejects.toThrow(/symbolic|symlink/i);
  expect(fs.statSync(target).isDirectory()).toBe(true);
});
it("serializes multiple processes contending on a dead lock", async () => {
  const file = fixture(),
    record = path.join(path.dirname(file), "events.txt");
  fs.mkdirSync(file);
  fs.writeFileSync(
    path.join(file, "owner.json"),
    JSON.stringify({ ownerId: "stale", pid: 99999999, acquiredAtMs: 0 }),
  );
  const moduleUrl = new URL("./lock.mjs", import.meta.url).href;
  const code = `import fs from 'node:fs';import {withDirectoryLock} from ${JSON.stringify(moduleUrl)};await withDirectoryLock(process.argv[1],async()=>{fs.appendFileSync(process.argv[2],process.pid+':start\\n');await new Promise(r=>setTimeout(r,25));fs.appendFileSync(process.argv[2],process.pid+':end\\n');},{pollIntervalMs:2});`;
  const children = Array.from({ length: 6 }, () =>
    spawn(process.execPath, ["--input-type=module", "-e", code, file, record], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  try {
    const results = await Promise.all(
      children.map(async (child) => {
        let err = "";
        child.stderr.on("data", (chunk) => (err += chunk));
        const [exit] = await once(child, "exit");
        return { exit, err };
      }),
    );
    expect(results).toEqual(results.map(() => ({ exit: 0, err: "" })));
    const events = fs.readFileSync(record, "utf8").trim().split("\n");
    expect(events).toHaveLength(12);
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]).toMatch(/:start$/);
      expect(events[i + 1]).toBe(events[i].replace(":start", ":end"));
    }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
  }
}, 10000);
