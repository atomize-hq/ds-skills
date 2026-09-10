import {
  validateKeys,
  requireLiteral,
  requireUniqueStringArray,
  requireEnum,
  isPlainObject,
} from "./status-checks.mjs";
const checkConclusionValues = ["success", "neutral", "failure", "skipped"];
const diffOutcomeToCheckConclusion = {
  passed: "success",
  changed: "neutral",
  failed: "failure",
  deferred: "skipped",
};
const gitShaPattern = /^[a-f0-9]{40}$/;
const utcIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export function validateBranch(errors, branch) {
  if (!isPlainObject(branch)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_BRANCH] branch must be an object",
    );
    return;
  }

  validateKeys(errors, branch, ["name"], [], "branch");
  if (
    typeof branch.name !== "string" ||
    branch.name.trim() !== branch.name ||
    branch.name.length === 0
  ) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_BRANCH_NAME] branch.name must be a non-empty trimmed string",
    );
  }
}

export function validateRevision(errors, revision, expectedGitSha) {
  if (!isPlainObject(revision)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_REVISION] revision must be an object",
    );
    return;
  }

  validateKeys(errors, revision, ["gitSha"], [], "revision");
  if (
    typeof revision.gitSha !== "string" ||
    !gitShaPattern.test(revision.gitSha)
  ) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_GIT_SHA] revision.gitSha must be a 40-character lowercase git SHA",
    );
    return;
  }

  if (expectedGitSha && revision.gitSha !== expectedGitSha) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_GIT_SHA_MISMATCH] revision.gitSha must equal expected git SHA ${expectedGitSha}`,
    );
  }
}

export function validateProofInventory(errors, proofInventory, options) {
  if (!isPlainObject(proofInventory)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_PROOF_INVENTORY] proofInventory must be an object",
    );
    return null;
  }

  validateKeys(
    errors,
    proofInventory,
    ["path", "inventoryVersion", "selectedComponentIds", "selectedStoryIds"],
    [],
    "proofInventory",
  );
  requireLiteral(
    errors,
    proofInventory.path,
    options.inventoryPath,
    "proofInventory.path",
  );
  requireLiteral(
    errors,
    proofInventory.inventoryVersion,
    options.inventoryVersion,
    "proofInventory.inventoryVersion",
  );
  const selectedComponentIds = requireUniqueStringArray(
    errors,
    proofInventory.selectedComponentIds,
    "proofInventory.selectedComponentIds",
  );
  const selectedStoryIds = requireUniqueStringArray(
    errors,
    proofInventory.selectedStoryIds,
    "proofInventory.selectedStoryIds",
  );

  return {
    selectedComponentIds,
    selectedStoryIds,
  };
}

export function validateBuild(errors, build) {
  if (!isPlainObject(build)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_BUILD] build must be an object",
    );
    return;
  }

  validateKeys(errors, build, ["url"], [], "build");
  if (typeof build.url !== "string") {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_BUILD_URL] build.url must be a valid URL",
    );
    return;
  }

  try {
    const url = new URL(build.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("unsafe build URL");
  } catch {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_BUILD_URL] build.url must be a valid URL",
    );
  }
}

export function validateCheck(errors, check, diffOutcome, options) {
  if (!isPlainObject(check)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_CHECK] check must be an object",
    );
    return;
  }

  validateKeys(errors, check, ["name", "conclusion"], [], "check");
  requireLiteral(errors, check.name, options.checkName, "check.name");
  requireEnum(
    errors,
    check.conclusion,
    checkConclusionValues,
    "check.conclusion",
  );

  if (typeof diffOutcome === "string") {
    const expectedConclusion = diffOutcomeToCheckConclusion[diffOutcome];
    if (expectedConclusion && check.conclusion !== expectedConclusion) {
      errors.push(
        `[CT-10B_CHROMATIC_STATUS_CHECK_CONCLUSION_MISMATCH] check.conclusion must be ${expectedConclusion} when review.diffOutcome is ${diffOutcome}`,
      );
    }
  }
}

export function validateGeneratedAt(errors, generatedAt, options) {
  if (
    typeof generatedAt !== "string" ||
    !utcIsoPattern.test(generatedAt) ||
    Number.isNaN(Date.parse(generatedAt)) ||
    (Number.isFinite(Date.parse(generatedAt)) &&
      new Date(generatedAt).toISOString().replace(".000Z", "Z") !==
        generatedAt.replace(".000Z", "Z"))
  ) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_TIMESTAMP] generatedAt must be an ISO-8601 UTC timestamp",
    );
    return;
  }

  const generatedTime = Date.parse(generatedAt);
  const ageMs = options.now.getTime() - generatedTime;
  if (ageMs < -options.maxFutureSkewSeconds * 1000)
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_FUTURE] generatedAt is beyond the allowed clock skew",
    );
  if (ageMs > options.maxAgeMinutes * 60 * 1000) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_STALE] generatedAt must be no older than ${options.maxAgeMinutes} minutes`,
    );
  }
}
