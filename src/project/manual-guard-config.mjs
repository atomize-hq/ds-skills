import path from "node:path";
import { exact, fail, resolveProjectPath } from "./config.mjs";

export function readManualGuard(value, root, build) {
  if (value == null) return null;
  exact(value, ["policy", "generatorInputs"], "tokens.manualEditGuard");
  if (!build) fail("tokens.manualEditGuard requires tokens.build");
  if (value.policy !== "git-input-dirty-v1")
    fail("Unsupported manual edit guard policy");
  if (!Array.isArray(value.generatorInputs) || !value.generatorInputs.length)
    fail("manualEditGuard.generatorInputs must list product pin inputs");
  const generatorInputs = value.generatorInputs.map((p) =>
    resolveProjectPath(root, p, "manualEditGuard.generatorInputs"),
  );
  if (
    new Set(generatorInputs).size !== generatorInputs.length ||
    generatorInputs.includes(root)
  )
    fail("Manual edit guard generator inputs must be unique non-root paths");
  if (
    generatorInputs.some((input) =>
      Object.values(build.outputs).some(
        (output) => contains(input, output) || contains(output, input),
      ),
    )
  )
    fail("A generated output cannot excuse its own modification");
  return { policy: value.policy, generatorInputs };
}

function contains(parent, child) {
  const rel = path.relative(parent, child);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
}
