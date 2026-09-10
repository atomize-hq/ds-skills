import { exact, fail, resolveProjectPath } from "./config.mjs";
export function readChromaticPublish(data, root) {
  if (data === undefined || data === null) return null;
  exact(
    data,
    [
      "provider",
      "buildDir",
      "tokenEnv",
      "repository",
      "timeoutSeconds",
      "mode",
    ],
    "storybook.chromatic.publish",
  );
  if (data.provider !== "chromatic-node-v15")
    fail("Unsupported Chromatic publication provider");
  if (
    typeof data.buildDir !== "string" ||
    !data.buildDir.trim() ||
    data.buildDir.trim() !== data.buildDir
  )
    fail("publish.buildDir must be a trimmed project-relative directory");
  if (
    typeof data.tokenEnv !== "string" ||
    !/^[A-Z_][A-Z_0-9]*$/.test(data.tokenEnv)
  )
    fail("publish.tokenEnv must name the selected credential variable");
  if (
    typeof data.repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.repository) ||
    data.repository.split("/").some((v) => [".", ".."].includes(v))
  )
    fail("publish.repository must be owner/repository");
  if (
    !Number.isSafeInteger(data.timeoutSeconds) ||
    data.timeoutSeconds < 1 ||
    data.timeoutSeconds > 3600
  )
    fail("publish.timeoutSeconds must be from 1 to 3600");
  if (!["review", "deferred"].includes(data.mode))
    fail("publish.mode must be review or deferred");
  return {
    ...data,
    buildDir: resolveProjectPath(root, data.buildDir, "publish.buildDir"),
  };
}
