import { readChromatic } from "./chromatic-config.mjs";
import { readStorybookProof } from "./storybook-proof-config.mjs";
import { exact, fail, resolveProjectPath } from "./config.mjs";

export function readStorybook(data, root) {
  if (data === undefined || data === null) return null;
  exact(
    data,
    [
      "format",
      "inventory",
      "tierPolicy",
      "versionPolicy",
      "proof",
      "chromatic",
    ],
    "storybook",
  );
  if (data.format !== "csf-policy-v1")
    fail("storybook.format must be csf-policy-v1");
  return {
    format: data.format,
    chromatic: readChromatic(data.chromatic, root),
    proof: readStorybookProof(data.proof, root),
    ...Object.fromEntries(
      ["inventory", "tierPolicy", "versionPolicy"].map((key) => [
        key,
        resolveProjectPath(root, data[key], `storybook.${key}`),
      ]),
    ),
  };
}
