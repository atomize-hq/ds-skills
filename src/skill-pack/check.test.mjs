import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { checkSkillPack, coreSkills } from "./check.mjs";
const source = fileURLToPath(new URL("../../", import.meta.url)),
  roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-skill-contract-"));
  roots.push(root);
  for (const group of ["skills", "templates", "schemas"])
    fs.cpSync(path.join(source, group), path.join(root, group), {
      recursive: true,
    });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
it("retains all nine reusable responsibilities with resolvable references and no consumer assumptions", () => {
  const report = checkSkillPack(source);
  expect(report.diagnostics).toEqual([]);
  expect(report.skills).toHaveLength(9);
  expect(coreSkills).toContain("library-component-builder");
  expect(coreSkills).toContain("interactive-workspace-builder");
});
it.each(["missing", "reference", "identity", "metadata", "path", "retired"])(
  "rejects a %s regression",
  (mode) => {
    const root = fixture(),
      file = path.join(root, "skills/stack-orchestrator/SKILL.md");
    if (mode === "missing") fs.rmSync(path.dirname(file), { recursive: true });
    if (mode === "reference")
      fs.appendFileSync(file, "\n[missing](references/missing.md)\n");
    if (mode === "identity")
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, "utf8")
          .replace("name: stack-orchestrator", "name: wrong"),
      );
    if (mode === "metadata")
      fs.writeFileSync(
        path.join(path.dirname(file), "agents/openai.yaml"),
        "interface: {}\n",
      );
    if (mode === "path")
      fs.appendFileSync(
        file,
        "\nUse /home/developer/project to resolve this consumer.\n",
      );
    if (mode === "retired")
      fs.appendFileSync(file, "\nEnable the pilot gate.\n");
    expect(checkSkillPack(root).ok).toBe(false);
  },
);
it("permits selected library names in actual examples without a static supported-package ban", () => {
  const root = fixture();
  fs.appendFileSync(
    path.join(root, "skills/library-component-builder/SKILL.md"),
    "\nAn explicitly selected AI Elements or Plate source is evidence, not a global default.\n",
  );
  expect(checkSkillPack(root).ok).toBe(true);
});
it("ignores unrelated consumer skills and custom generated content when checking core layout", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "skills/user-private"));
  fs.writeFileSync(
    path.join(root, "skills/user-private/SKILL.md"),
    "user owned",
  );
  expect(checkSkillPack(root).ok).toBe(true);
});
it("keeps recipe, static coverage, execution, publication and curation obligations explicit", () => {
  const text = fs.readFileSync(
    path.join(
      source,
      "skills/stack-orchestrator/references/project-contract.md",
    ),
    "utf8",
  );
  for (const term of [
    "static source/reference coverage",
    "not executed UI tests",
    "publication ledger",
    "curation installed check",
    "no hidden model",
    "preserve variable/component IDs",
  ])
    expect(text.toLowerCase()).toContain(term.toLowerCase());
});

it("validates support-document references in the installed layout, not only entrypoints", () => {
  const root = fixture();
  fs.appendFileSync(
    path.join(root, "schemas/README.md"),
    "\n[not installed](../src/private.mjs)\n",
  );
  expect(checkSkillPack(root).ok).toBe(false);
});

it("scans schema and template JSON descriptions as maintained instructions", () => {
  const root = fixture();
  fs.writeFileSync(
    path.join(root, "schemas/sync-ledger.schema.json"),
    JSON.stringify({ description: "restore codeConnect enrollment" }),
  );
  expect(checkSkillPack(root).ok).toBe(false);
});
