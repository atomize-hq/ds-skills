import { expect, it } from "vitest";
import { readReceipt } from "./receipt.mjs";
const receipt = () => ({
  installationVersion: "2",
  release: "v1.0.0",
  sourceCommit: "a".repeat(40),
  pinSha256: "b".repeat(64),
  files: {
    ".ds-skills/project.mjs": { sha256: "c".repeat(64), executable: false },
  },
});
it.each([
  "../user-file",
  ".ds-skills/installation.json",
  ".agents/skills",
  ".agents/skills/user/../SKILL.md",
  ".agents/skills/user/con",
  ".claude/skills/user/C:evil",
  ".agents/skills/user/back\\slash",
  ".agents/settings.json",
])("rejects receipt path outside the managed contract: %s", (relative) => {
  const value = receipt();
  value.files[relative] = { sha256: "a".repeat(64), executable: false };
  expect(() => readReceipt(Buffer.from(JSON.stringify(value)))).toThrow(
    "Invalid installation receipt",
  );
});
it.each([
  { sha256: "x", executable: false },
  { sha256: "c".repeat(64), executable: "false" },
  { sha256: "c".repeat(64), executable: false, ignored: 1 },
])("rejects malformed owned-file record %j", (entry) => {
  const value = receipt();
  value.files[".ds-skills/project.mjs"] = entry;
  expect(() => readReceipt(Buffer.from(JSON.stringify(value)))).toThrow(
    "Invalid file digest/mode",
  );
});
it("rejects cross-platform case aliases and file/directory collisions", () => {
  for (const pair of [
    [".agents/skills/example/SKILL.md", ".agents/skills/example/skill.md"],
    [
      ".agents/skills/example/references",
      ".agents/skills/example/references/guide.md",
    ],
  ]) {
    const value = receipt();
    for (const file of pair)
      value.files[file] = { sha256: "a".repeat(64), executable: false };
    expect(() => readReceipt(Buffer.from(JSON.stringify(value)))).toThrow(
      /Case-colliding|File\/directory collision/,
    );
  }
});
