import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { proofFixture } from "./proof-fixture.mjs";
import { validateStorybookProofStructure } from "./proof-structure.mjs";
import {
  captureProofInputs,
  assertProofInputsUnchanged,
} from "./proof-inputs.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(options) {
  const f = proofFixture(options);
  roots.push(f.root);
  return f;
}
const check = (f) => validateStorybookProofStructure(f.project());
it("resolves configured roots and nonstandard proof keys for different consumers", () => {
  for (const options of [
    {},
    {
      component: "workspace-tree",
      tier: "composite",
      consumer: "desktop-review",
    },
  ]) {
    const f = fixture(options);
    expect(check(f)).toMatchObject({ ok: true, storyCount: 1, sourceCount: 1 });
    expect(check(f).componentFacts[0].generatedArtifactRefs).toEqual({
      guidance: null,
    });
  }
});
it.each([
  [
    "missing spec",
    (f) => fs.unlinkSync(path.join(f.root, `specs/${f.component}.json`)),
    "MISSING_SPEC_FILE",
  ],
  [
    "filename mismatch",
    (f) => {
      fs.renameSync(
        path.join(f.root, `specs/${f.component}.json`),
        path.join(f.root, "specs/different.json"),
      );
    },
    "FILENAME_MISMATCH",
  ],
  [
    "unknown tier",
    (f) => {
      f.spec.tier = "unknown";
    },
    "UNKNOWN_TIER",
  ],
  [
    "missing tier minimum",
    (f) => {
      f.spec.requiredStoryKinds = ["docs"];
    },
    "TIER_MINIMUM_KIND_MISSING",
  ],
  [
    "missing story",
    (f) => {
      f.write(
        "library/demo.stories.tsx",
        "export default {title:'Demo'};export const Other={};",
      );
    },
    "UNRESOLVED_STORY_REF",
  ],
  [
    "duplicate story",
    (f) =>
      f.write(
        "library/duplicate.stories.tsx",
        "export default {title:'notice'};export const Default={};",
      ),
    "DUPLICATE_STORY_ID",
  ],
  [
    "artifact missing",
    (f) => {
      f.spec.generatedArtifactRefs.guidance = "library/missing.stories.tsx";
    },
    "UNRESOLVED_GENERATED_ARTIFACT_REF",
  ],
  [
    "artifact traversal",
    (f) => {
      f.spec.generatedArtifactRefs.guidance = "library/../../outside.tsx";
    },
    "INVALID_REPO_PATH",
  ],
  [
    "artifact windows path",
    (f) => {
      f.spec.generatedArtifactRefs.guidance = "C:\\outside.tsx";
    },
    "INVALID_REPO_PATH",
  ],
  [
    "artifact schema key mismatch",
    (f) => {
      f.spec.generatedArtifactRefs = { other: null };
    },
    "ARTIFACT_KEYS",
  ],
  [
    "kind mismatch",
    (f) => {
      f.spec.ownedStoryRefs[0].kinds = ["docs"];
    },
    "KIND_MISMATCH",
  ],
  [
    "owned ref absent",
    (f) => {
      f.spec.ownedStoryRefs.push({
        storyId: "notice--extra",
        kinds: ["default"],
      });
    },
    "OWNED_REF_MISSING",
  ],
  [
    "example absent",
    (f) => {
      f.spec.downstreamHooks.exampleStoryIds = ["notice--absent"];
    },
    "EXAMPLE_MISSING",
  ],
  [
    "orphan spec",
    (f) => {
      f.data.inventory.components = [];
    },
    "ORPHAN_SPEC",
  ],
  [
    "unowned story",
    (f) => {
      f.spec.ownedStoryRefs = [
        { storyId: "notice--other", kinds: ["default"] },
      ];
    },
    "STORY_NOT_OWNED_BY_SPEC",
  ],
])("retains/strengthens proof check %s", (_, mutate, code) => {
  const f = fixture();
  mutate(f);
  if (fs.existsSync(path.join(f.root, `specs/${f.component}.json`)))
    f.write(`specs/${f.component}.json`, f.spec);
  f.write(f.config.storybook.inventory, f.data.inventory);
  const result = check(f);
  expect(result.ok).toBe(false);
  expect(result.componentFacts).toBeNull();
  expect(result.errors.join("\n")).toContain(code);
});
it("accepts generated story references through configured surfaces", () => {
  const f = fixture();
  f.write(
    "library/generated.stories.ts",
    "export default {title:'Generated'}; export const Docs={};",
  );
  f.spec.generatedArtifactRefs.guidance = "library/generated.stories.ts";
  f.data.inventory.components[0].validatorKinds.push("docs");
  f.data.inventory.components[0].implementedStoryRefs.push({
    kind: "docs",
    storyId: "generated--docs",
  });
  f.write(`specs/${f.component}.json`, f.spec);
  f.write(f.config.storybook.inventory, f.data.inventory);
  expect(check(f).ok).toBe(true);
});
it.each([
  [
    "unsupported extension",
    (f) => f.write("library/wrong.stories.jsx", "export default {};"),
  ],
  [
    "missing root",
    (f) => fs.rmSync(path.join(f.root, "library"), { recursive: true }),
  ],
  [
    "symlinked story",
    (f) =>
      fs.symlinkSync(
        "demo.stories.tsx",
        path.join(f.root, "library/linked.stories.tsx"),
      ),
  ],
  [
    "symlinked directory",
    (f) => fs.symlinkSync("../library", path.join(f.root, "library/link")),
  ],
  [
    "missing policy",
    (f) => fs.unlinkSync(path.join(f.root, f.config.storybook.versionPolicy)),
  ],
])("cannot evaluate %s", (_, mutate) => {
  const f = fixture();
  mutate(f);
  expect(() => check(f)).toThrow();
});
it("detects newly added story inputs, not just changed existing bytes", () => {
  const f = fixture(),
    p = f.project(),
    snapshot = captureProofInputs(p);
  f.write(
    "library/new.stories.ts",
    "export default {title:'New'}; export const Basic={};",
  );
  expect(() => assertProofInputsUnchanged(p, snapshot)).toThrow("changed");
});
