import fs from "node:fs";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  lockError,
  stat,
  readOwner,
  validOwner,
  processAlive,
} from "./lock-state.mjs";

/**
 * Serialize the synchronous claim/recovery/release metadata operations. A dead
 * guard is NOT automatically unlinked: concurrent "recoverers" could unlink a
 * replacement guard, which is the same stale-owner race this guard prevents.
 * An interrupted metadata operation fails closed and requires manual inspection.
 */
export async function coordinate(
  lockPath,
  callback,
  { pollIntervalMs, timeoutMs, staleAfterMs },
) {
  const file = `${lockPath}.guard`,
    deadline = Date.now() + timeoutMs;
  const owner = { ownerId: crypto.randomUUID(), pid: process.pid };
  while (true) {
    let fd;
    try {
      fd = fs.openSync(file, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = stat(file);
      if (!info) continue;
      const prior = readOwner(file);
      if (
        (validOwner(prior) && !processAlive(prior.pid)) ||
        (!validOwner(prior) && Date.now() - info.mtimeMs > staleAfterMs)
      ) {
        const latest = stat(file);
        if (
          !latest ||
          latest.ino !== info.ino ||
          latest.mtimeMs !== info.mtimeMs ||
          readOwner(file)?.ownerId !== prior?.ownerId
        )
          continue;
        throw lockError(
          `Abandoned coordination guard ${file}; manual inspection is required before removing it. No lock or output was reclaimed.`,
        );
      }
      if (Date.now() >= deadline)
        throw lockError(`Timed out waiting for coordination guard ${file}`);
      await delay(pollIntervalMs);
      continue;
    }
    try {
      fs.writeFileSync(fd, JSON.stringify(owner));
      fs.closeSync(fd);
      fd = undefined;
      return callback(); // Internal synchronous operations only; never await here.
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      const current = readOwner(file);
      if (current?.ownerId === owner.ownerId) fs.unlinkSync(file);
    }
  }
}
