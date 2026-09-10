import { readChromaticPublish } from "./chromatic-publish-config.mjs";
import { exact, fail, resolveProjectPath } from "./config.mjs";
export function readChromatic(data, root) {
  if (data === undefined || data === null) return null;
  exact(
    data,
    [
      "status",
      "lockPath",
      "checkName",
      "requiredForClaim",
      "maxAgeMinutes",
      "maxFutureSkewSeconds",
      "restore",
      "publish",
    ],
    "storybook.chromatic",
  );
  for (const key of ["status", "lockPath", "checkName"])
    if (
      typeof data[key] !== "string" ||
      !data[key].trim() ||
      data[key].trim() !== data[key]
    )
      fail(`storybook.chromatic.${key} must be a trimmed string`);
  for (const key of ["maxAgeMinutes", "maxFutureSkewSeconds"])
    if (!Number.isSafeInteger(data[key]) || data[key] < 0 || data[key] > 525600)
      fail(`storybook.chromatic.${key} must be an integer from 0 to 525600`);
  if (typeof data.requiredForClaim !== "boolean")
    fail("storybook.chromatic.requiredForClaim must be boolean");
  return {
    ...data,
    status: resolveProjectPath(root, data.status, "storybook.chromatic.status"),
    lockPath: resolveProjectPath(
      root,
      data.lockPath,
      "storybook.chromatic.lockPath",
    ),
    restore: readRestore(data.restore),
    publish: readChromaticPublish(data.publish, root),
  };
}
function readRestore(data) {
  if (data === undefined || data === null) return null;
  exact(
    data,
    [
      "apiBase",
      "repository",
      "workflow",
      "artifactPrefix",
      "entry",
      "tokenEnv",
      "maxPages",
    ],
    "storybook.chromatic.restore",
  );
  let url;
  try {
    url = new URL(data.apiBase);
  } catch {
    fail("restore.apiBase must be an API base URL");
  }
  const loopback =
    url.protocol === "http:" &&
    ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail(
      "restore.apiBase requires HTTPS (HTTP loopback is permitted for local fixtures), without credentials/query/fragment",
    );
  if (
    typeof data.repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.repository) ||
    data.repository.split("/").some((v) => [".", ".."].includes(v))
  )
    fail("restore.repository must be owner/repository");
  if (
    typeof data.workflow !== "string" ||
    !/^[A-Za-z0-9_.-]+\.ya?ml$/.test(data.workflow)
  )
    fail("restore.workflow must be a workflow filename");
  if (
    typeof data.artifactPrefix !== "string" ||
    !/^[A-Za-z0-9_.-]+$/.test(data.artifactPrefix)
  )
    fail("restore.artifactPrefix must be a nonempty artifact name prefix");
  if (
    typeof data.entry !== "string" ||
    /[\\:]/.test(data.entry) ||
    data.entry.split("/").some((v) => !v || v === "." || v === "..")
  )
    fail("restore.entry must be a normalized relative ZIP member path");
  if (
    typeof data.tokenEnv !== "string" ||
    !/^[A-Z_][A-Z_0-9]*$/.test(data.tokenEnv)
  )
    fail(
      "restore.tokenEnv must name the explicitly selected credential environment variable",
    );
  if (
    !Number.isSafeInteger(data.maxPages) ||
    data.maxPages < 1 ||
    data.maxPages > 100
  )
    fail("restore.maxPages must be from 1 to 100");
  return { ...data, apiBase: url.href.replace(/\/$/, "") };
}
