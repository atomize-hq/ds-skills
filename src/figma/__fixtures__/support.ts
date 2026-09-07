import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readProfile } from "../profile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const syncLedgerFixtureDir = path.join(here, "sync-ledger");
export const publishProofFixtureDir = path.join(here, "publish-proof");
export const profileFixtureDir = path.join(here, "profiles");

export function profilePath(name: "consumer-a" | "consumer-b"): string {
  return path.join(profileFixtureDir, `${name}.json`);
}

/** Resolved through the real reader, so a test can never use a shape the CLI would reject. */
export function fixtureProfile(
  name: "consumer-a" | "consumer-b" = "consumer-a",
) {
  return readProfile(profilePath(name)).profile;
}

export function ledgerFixturePath(name: string): string {
  return path.join(syncLedgerFixtureDir, name);
}

export function proofFixturePath(name: string): string {
  return path.join(publishProofFixtureDir, name);
}

export function readLedgerFixture(name: string) {
  return JSON.parse(fs.readFileSync(ledgerFixturePath(name), "utf8"));
}

export function createWritableBuffer() {
  let buffer = "";
  return {
    write(chunk: string | Uint8Array) {
      buffer +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    },
    read() {
      return buffer;
    },
  };
}
