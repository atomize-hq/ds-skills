import { exact, fail, resolveProjectPath } from "./config.mjs";
export const componentEvidenceIds = [
  "story-coverage",
  "visual-review",
  "figma-publication",
];
const identifier = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function readComponents(value, root) {
  if (value == null) return null;
  exact(
    value,
    ["report", "lockPath", "maxAgeMinutes", "profiles"],
    "components",
  );
  if (
    !Number.isSafeInteger(value.maxAgeMinutes) ||
    value.maxAgeMinutes < 1 ||
    value.maxAgeMinutes > 525600
  )
    fail("components.maxAgeMinutes must be an integer from 1 to 525600");
  exact(
    value.profiles,
    Object.keys(value.profiles ?? {}),
    "components.profiles",
  );
  if (!Object.keys(value.profiles).length)
    fail("components.profiles must not be empty");
  const profiles = Object.fromEntries(
    Object.entries(value.profiles).map(([id, profile]) => {
      if (!identifier(id))
        fail("Component policy profile IDs must be lowercase identifiers");
      exact(
        profile,
        ["requirements", "consumers"],
        `components.profiles.${id}`,
      );
      if (
        !Array.isArray(profile.requirements) ||
        new Set(profile.requirements).size !== profile.requirements.length ||
        profile.requirements.some((r) => !componentEvidenceIds.includes(r))
      )
        fail(`Profile ${id} has invalid evidence requirements`);
      exact(
        profile.consumers,
        Object.keys(profile.consumers ?? {}),
        `profiles.${id}.consumers`,
      );
      if (!Object.keys(profile.consumers).length)
        fail(`Profile ${id} needs explicit consumers`);
      for (const [consumer, mode] of Object.entries(profile.consumers))
        if (!identifier(consumer) || !["advisory", "blocking"].includes(mode))
          fail(`Profile ${id} has invalid consumer enforcement`);
      return [
        id,
        {
          requirements: [...profile.requirements],
          consumers: { ...profile.consumers },
        },
      ];
    }),
  );
  return {
    report: resolveProjectPath(root, value.report, "components.report"),
    lockPath: resolveProjectPath(root, value.lockPath, "components.lockPath"),
    maxAgeMinutes: value.maxAgeMinutes,
    profiles,
  };
}
