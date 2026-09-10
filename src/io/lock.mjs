import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { coordinate } from "./lock-guard.mjs";
import {
  lockError,
  stat,
  readOwner,
  validOwner,
  processAlive,
  positiveOption,
} from "./lock-state.mjs";

export async function withDirectoryLock(file, callback, options = {}) {
  const lock = await acquireDirectoryLock(file, options);
  try {
    return await callback(lock);
  } finally {
    await lock.release();
  }
}
export async function acquireDirectoryLock(file, options = {}) {
  const lockPath = path.resolve(file),
    metadata = path.join(lockPath, "owner.json");
  const settings = {
    pollIntervalMs: positiveOption(
      options.pollIntervalMs,
      100,
      "pollIntervalMs",
    ),
    staleAfterMs: positiveOption(options.staleAfterMs, 120000, "staleAfterMs"),
    timeoutMs: positiveOption(options.timeoutMs, 300000, "timeoutMs"),
  };
  const deadline = Date.now() + settings.timeoutMs;
  const record = {
    protocolVersion: "2",
    ownerId: crypto.randomUUID(),
    pid: process.pid,
    label: options.label ?? path.basename(file),
    acquiredAtMs: Date.now(),
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  while (true) {
    const acquired = await coordinate(
      lockPath,
      () => {
        const info = stat(lockPath);
        if (info) {
          if (info.isSymbolicLink())
            throw lockError(`Refusing symlink at lock ${lockPath}`);
          if (!info.isDirectory())
            throw lockError(`Lock path is not a directory: ${lockPath}`);
          const prior = readOwner(metadata);
          if (validOwner(prior) && processAlive(prior.pid)) return false;
          if (
            !validOwner(prior) &&
            Date.now() - info.mtimeMs <= settings.staleAfterMs
          )
            return false;
          removeOwnedDirectory(lockPath);
        }
        fs.mkdirSync(lockPath);
        record.acquiredAtMs = Date.now();
        fs.writeFileSync(metadata, JSON.stringify(record), {
          flag: "wx",
          mode: 0o600,
        });
        return true;
      },
      settings,
    );
    if (acquired) break;
    if (Date.now() >= deadline)
      throw lockError(`Timed out waiting for lock ${lockPath}`);
    await delay(settings.pollIntervalMs);
  }
  let released = false;
  return {
    record,
    async release() {
      if (released) return;
      await coordinate(
        lockPath,
        () => {
          const current = readOwner(metadata);
          if (current?.ownerId !== record.ownerId)
            throw lockError(
              `Lock ownership changed before release: ${lockPath}`,
            );
          removeOwnedDirectory(lockPath);
        },
        settings,
      );
      released = true;
    },
  };
}
function removeOwnedDirectory(file) {
  const names = fs.readdirSync(file);
  if (names.some((name) => name !== "owner.json"))
    throw lockError(
      `Unexpected contents in lock ${file}; refusing recursive deletion`,
    );
  if (names.includes("owner.json")) {
    readOwner(path.join(file, "owner.json"));
    fs.unlinkSync(path.join(file, "owner.json"));
  }
  fs.rmdirSync(file);
}
