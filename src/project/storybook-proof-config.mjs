import { exact, fail, resolveProjectPath } from "./config.mjs";
export function readStorybookProof(data, root) {
  if (data === undefined || data === null) return null;
  exact(
    data,
    [
      "adapter",
      "formatting",
      "storyRoots",
      "componentSpecs",
      "generatedArtifactKeys",
      "coverage",
      "lockPath",
    ],
    "storybook.proof",
  );
  if (data.adapter !== "csf-ts-v1")
    fail("storybook.proof.adapter must be csf-ts-v1");
  for (const key of ["storyRoots", "generatedArtifactKeys"]) {
    const values = data[key];
    if (
      !Array.isArray(values) ||
      (key === "storyRoots" && !values.length) ||
      values.some((v) => typeof v !== "string" || !v.trim()) ||
      new Set(values).size !== values.length
    )
      fail(
        `storybook.proof.${key} must be a unique string array${key === "storyRoots" ? " with at least one root" : ""}`,
      );
  }
  const formatting = data.formatting ?? {
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
  };
  exact(
    formatting,
    ["printWidth", "tabWidth", "useTabs"],
    "storybook.proof.formatting",
  );
  for (const key of ["printWidth", "tabWidth"])
    if (
      !Number.isInteger(formatting[key]) ||
      formatting[key] < 1 ||
      formatting[key] > 1000
    )
      fail(
        `storybook.proof.formatting.${key} must be an integer from 1 to 1000`,
      );
  if (typeof formatting.useTabs !== "boolean")
    fail("storybook.proof.formatting.useTabs must be boolean");
  return {
    adapter: data.adapter,
    formatting: { ...formatting },
    generatedArtifactKeys: [...data.generatedArtifactKeys],
    storyRoots: data.storyRoots.map((v) =>
      resolveProjectPath(root, v, "storybook.proof.storyRoots"),
    ),
    ...Object.fromEntries(
      ["componentSpecs", "coverage", "lockPath"].map((key) => [
        key,
        resolveProjectPath(root, data[key], `storybook.proof.${key}`, {
          cooperativeLockDirectory: key === "lockPath",
        }),
      ]),
    ),
  };
}
