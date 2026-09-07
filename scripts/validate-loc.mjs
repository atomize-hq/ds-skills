#!/usr/bin/env node
/**
 * The LOC guard, reading tokei JSON on stdin. Counts CODE lines, so a file is
 * not pushed over the limit by its own explanation.
 *
 * Mirrors the consumer's guard deliberately: SPEC.md §6 asks for "the same LOC
 * guard", and a second counting rule would make the two numbers incomparable.
 */
import process from "node:process";

const limit = Number(process.argv[2]);
if (!Number.isFinite(limit) || limit <= 0) {
  fail(
    "Usage: tokei --files --output json <dirs> | node scripts/validate-loc.mjs <limit>",
  );
}

const input = await readStdin();
if (!input.trim()) {
  // A guard that passes when its input is empty is not a guard. tokei being
  // absent must fail the check, never skip it.
  fail("Expected tokei JSON on stdin. Is tokei installed?");
}

const payload = JSON.parse(input);
const offenders = [];
let counted = 0;

for (const [language, entry] of Object.entries(payload)) {
  if (language === "Total" || !Array.isArray(entry?.reports)) continue;
  for (const report of entry.reports) {
    counted += 1;
    if (report.stats.code > limit) {
      offenders.push({ name: report.name, code: report.stats.code });
    }
  }
}

if (counted === 0) {
  fail("tokei reported no files; the guard would have passed vacuously.");
}

if (offenders.length > 0) {
  offenders.sort((left, right) => right.code - left.code);
  process.stderr.write(
    `${offenders.length} file(s) over ${limit} code lines:\n` +
      offenders
        .map((o) => `  ${String(o.code).padStart(5)}  ${o.name}`)
        .join("\n") +
      "\n",
  );
  process.exit(1);
}

process.stdout.write(`✓ ${counted} file(s) within ${limit} code lines\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
