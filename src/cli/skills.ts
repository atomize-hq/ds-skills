import { checkSkillsRelease } from "../release.js";
import { EXIT_NONCONFORMANT, EXIT_OK } from "./exit-codes.js";
import type { Streams } from "./figma.js";

/**
 * Where the installed skills are, and whether they came from this CLI.
 *
 * Discovery and skew are one command because they are one question. A consumer
 * that has to be told the path can be told the wrong path; printing the path
 * this install actually resolves, next to the release both sides claim, is the
 * only form of the answer that cannot be stale.
 */
export function runSkillsCommand(
  options: Readonly<Record<string, string>>,
  io: Streams,
): number {
  const root = options["root"];
  const report = checkSkillsRelease(
    root === undefined || root === "true" ? {} : { root },
  );

  io.stdout.write(
    `${report.ok ? "✓" : "✗"} skills: ${report.root}\n` +
      `[RAIL_SKILL_RELEASE] cli=${report.cli.release} skills=${report.materialized.release}\n` +
      report.skills.map((name) => `  ${name}\n`).join(""),
  );
  for (const error of report.errors) io.stderr.write(`${error}\n`);
  return report.ok ? EXIT_OK : EXIT_NONCONFORMANT;
}
