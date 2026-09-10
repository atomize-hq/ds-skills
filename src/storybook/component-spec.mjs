import fs from "node:fs";
import { validate } from "../validate/schema.mjs";
const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../schemas/storybook-component-spec.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

export function validateComponentSpec(
  data,
  { filenameStem, generatedArtifactKeys } = {},
) {
  const errors = validate(data, schema, {
    root: schema,
    profile: {},
    path: "",
  }).map((message) => `[STORYBOOK_SPEC_SCHEMA] ${message}`);
  if (errors.length) return errors;
  if (filenameStem !== undefined && data.componentId !== filenameStem)
    errors.push(
      `[CT-9B_COMPONENT_SPEC_FILENAME_MISMATCH] componentId must match filename stem ${filenameStem}`,
    );
  if (!data.tier.trim())
    errors.push("[STORYBOOK_SPEC_TIER] tier must not be blank");
  if (generatedArtifactKeys !== undefined) {
    const actual = Object.keys(data.generatedArtifactRefs).sort();
    if (
      JSON.stringify(actual) !==
      JSON.stringify([...generatedArtifactKeys].sort())
    )
      errors.push(
        "[STORYBOOK_SPEC_ARTIFACT_KEYS] generatedArtifactRefs must match the configured key set",
      );
  }
  for (const [key, value] of Object.entries(data.generatedArtifactRefs)) {
    if (value !== null && !safeRelative(value))
      errors.push(
        `[CT-9B_COMPONENT_SPEC_INVALID_REPO_PATH] generatedArtifactRefs.${key} must be a normalized portable relative path or null`,
      );
  }
  const seen = new Set();
  for (const ref of data.ownedStoryRefs) {
    if (!ref.storyId.trim())
      errors.push("[STORYBOOK_SPEC_STORY_ID] storyId must not be blank");
    if (seen.has(ref.storyId))
      errors.push(
        `[CT-9B_COMPONENT_SPEC_DUPLICATE_STORY_ID] duplicate owned storyId ${ref.storyId}`,
      );
    seen.add(ref.storyId);
  }
  if (
    new Set(data.downstreamHooks.exampleStoryIds).size !==
    data.downstreamHooks.exampleStoryIds.length
  )
    errors.push(
      "[STORYBOOK_SPEC_EXAMPLE_DUPLICATE] exampleStoryIds must be unique",
    );
  return errors;
}
function safeRelative(value) {
  return (
    typeof value === "string" &&
    value.trim() &&
    !/[\\:]/.test(value) &&
    value
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..")
  );
}
