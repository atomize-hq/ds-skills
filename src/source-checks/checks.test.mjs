import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { sourceChecksFixture } from "./fixture.mjs";
import { checkSourcePolicy } from "./policy.mjs";
import { checkSourceContract } from "./contract.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(options) {
  const f = sourceChecksFixture(options);
  roots.push(f.root);
  return f;
}
it.each([
  {},
  {
    provider: "packages/base",
    consumer: "features",
    prefix: "@workspace/atoms",
    component: "surface",
  },
])(
  "checks actual configured sources without library constants",
  async (options) => {
    const f = fixture(options);
    expect((await checkSourcePolicy(f.project())).ok).toBe(true);
    const r = checkSourceContract(f.project());
    expect(r.ok).toBe(true);
    expect(r.summary.importedBindings).toBe(1);
  },
);
it.each(["invariants", "deviations", "contracts"])(
  "retains %s failures with the declared reason",
  async (section) => {
    const f = fixture();
    f.policy[section] = [
      {
        id: "missing",
        ...(section === "invariants"
          ? { directory: f.provider }
          : { file: `${f.provider}/button.tsx` }),
        require: ["not-present"],
        reason: "Our actual obligation",
      },
    ];
    f.write("policy.json", f.policy);
    const r = await checkSourcePolicy(f.project());
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("Our actual obligation");
  },
);
it("rejects malformed policies and missing exact scopes without passing", async () => {
  const f = fixture();
  f.policy.contracts[0].file = "missing.tsx";
  f.write("policy.json", f.policy);
  expect((await checkSourcePolicy(f.project())).errors.join(" ")).toContain(
    "SCOPE_EMPTY",
  );
  f.policy.invariants[0].require = ["["];
  f.write("policy.json", f.policy);
  expect((await checkSourcePolicy(f.project())).errors.join(" ")).toContain(
    "POLICY_INVALID",
  );
});
it("bounds catastrophic regex evaluation in a disposable worker", async () => {
  const f = fixture();
  f.policy.invariants[0].require = ["(a+)+$"];
  f.policy.contracts = [];
  f.write("policy.json", f.policy);
  f.write("primitives/button.tsx", "a".repeat(30000) + "!");
  f.config.sourceChecks.policy.timeoutMs = 100;
  f.write("project.json", f.config);
  await expect(checkSourcePolicy(f.project())).rejects.toThrow(/timed out/);
});
it.each(["export", "module", "slot", "wrong owner"])(
  "detects a broken %s contract",
  (mode) => {
    const f = fixture();
    if (mode === "export")
      f.write(
        "primitives/button.tsx",
        'export const Other=()=> <button data-slot="button"/>;',
      );
    if (mode === "module")
      f.write(
        "composition/panel.tsx",
        `import {Control} from '${f.prefix}/absent';`,
      );
    if (mode === "slot")
      f.write("primitives/button.tsx", "export const Control=()=> <button/>;");
    if (mode === "wrong owner") {
      f.write("primitives/button.tsx", "export const Control=()=> <button/>;");
      f.write(
        "composition/unrelated.tsx",
        'export const Other=()=> <span data-slot="button"/>;',
      );
    }
    expect(checkSourceContract(f.project()).ok).toBe(false);
  },
);
it("ignores comments as declarations and checks runtime versus type-only exports", () => {
  const f = fixture();
  f.write(
    "primitives/button.tsx",
    "// export const Control=1;\nexport type Control = string;",
  );
  expect(checkSourceContract(f.project()).errors.join(" ")).toContain(
    "TYPE_ONLY_EXPORT",
  );
  f.write(
    "composition/panel.tsx",
    `import type {Control} from '${f.prefix}/button';`,
  );
  expect(checkSourceContract(f.project()).ok).toBe(true);
});
it("resolves a configured package entrypoint without assuming filename imports", () => {
  const f = fixture();
  f.config.sourceChecks.contract.providers[0].entrypoint = "button";
  f.write("project.json", f.config);
  f.write("composition/panel.tsx", `import {Control} from '${f.prefix}';`);
  expect(checkSourceContract(f.project()).ok).toBe(true);
});
it("requires unambiguous ownership or an explicit actual source owner", () => {
  const f = fixture();
  f.write(
    "composition/button.tsx",
    'export const Other=()=> <span data-slot="button"/>;',
  );
  expect(checkSourceContract(f.project()).errors.join(" ")).toContain(
    "AMBIGUOUS",
  );
  f.config.sourceChecks.contract.slots.owners.button = "primitives/button.tsx";
  f.write("project.json", f.config);
  expect(checkSourceContract(f.project()).ok).toBe(true);
});
it.each([
  "namespace",
  "import equals",
  "wildcard",
  "dynamic slot",
  "dynamic selector",
])("reports unsupported %s honestly", (mode) => {
  const f = fixture();
  if (mode === "namespace")
    f.write(
      "composition/panel.tsx",
      `import * as Base from '${f.prefix}/button';`,
    );
  if (mode === "import equals")
    f.write(
      "composition/panel.tsx",
      `import Base = require("${f.prefix}/button");`,
    );
  if (mode === "wildcard")
    f.write("primitives/button.tsx", `export * from './other';`);
  if (mode === "dynamic slot")
    f.write(
      "primitives/button.tsx",
      "export const Control=()=> <button data-slot={value}/>;",
    );
  if (mode === "dynamic selector")
    f.write("composition/panel.tsx", "const classes=`[data-slot=${value}]`;");
  expect(() => checkSourceContract(f.project())).toThrow();
});
it("refuses escaping paths, symlinks, and duplicate provider module keys", async () => {
  const f = fixture();
  f.policy.contracts[0].file = "../outside";
  f.write("policy.json", f.policy);
  await expect(checkSourcePolicy(f.project())).rejects.toThrow(/escapes/);
  f.write("primitives/button.ts", "export const Other=1;");
  expect(() => checkSourceContract(f.project())).toThrow(/Ambiguous/);
  fs.unlinkSync(path.join(f.root, "primitives/button.ts"));
  fs.symlinkSync("/etc/hosts", path.join(f.root, "primitives/link.tsx"));
  expect(() => checkSourceContract(f.project())).toThrow();
});
it("can explicitly disable slot convention checking while retaining API checks", () => {
  const f = fixture();
  f.config.sourceChecks.contract.slots.mode = "off";
  f.write("project.json", f.config);
  f.write(
    "primitives/button.tsx",
    "export const Control=()=> <button data-slot={value}/>;",
  );
  expect(checkSourceContract(f.project()).ok).toBe(true);
});
