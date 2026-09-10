import { exact, id, libraryError } from "../libraries/definition.mjs";
import { validateOutputPaths } from "../project-host/assets.mjs";
export const curatedReceiptPath = ".ds-skills/curation.json";
export const curatedFiles = [
  "SKILL.md",
  "references/guidance.md",
  "references/evidence.json",
];
export function readCuratedReceipt(bytes) {
  if (bytes === null) return null;
  try {
    const r = JSON.parse(bytes);
    exact(
      r,
      [
        "curatedInstallationVersion",
        "release",
        "sourceCommit",
        "pinSha256",
        "config",
        "configSha256",
        "bundleSha256",
        "reviewSha256",
        "evidenceSha256",
        "namespace",
        "skills",
        "files",
      ],
      "curated installation",
    );
    if (
      r.curatedInstallationVersion !== "1" ||
      typeof r.release !== "string" ||
      typeof r.sourceCommit !== "string" ||
      !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(r.release) ||
      !/^[a-f0-9]{40}$/.test(r.sourceCommit) ||
      [
        r.pinSha256,
        r.configSha256,
        r.bundleSha256,
        r.reviewSha256,
        r.evidenceSha256,
      ].some((v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) ||
      typeof r.config !== "string" ||
      r.config.startsWith("/") ||
      r.config.includes("\\") ||
      r.config.split("/").some((p) => !p || p === "." || p === "..") ||
      !id(r.namespace) ||
      r.namespace.length > 20 ||
      !Array.isArray(r.skills) ||
      !r.skills.length ||
      r.skills.length > 40 ||
      new Set(r.skills).size !== r.skills.length ||
      r.skills.some(
        (n) =>
          !id(n) ||
          n.length > 63 ||
          !n.startsWith(`ds-curated-${r.namespace}-`),
      )
    )
      throw new Error("Invalid identity or namespace");
    const expected = r.skills.flatMap((name) =>
      [".agents", ".claude"].flatMap((s) =>
        curatedFiles.map((f) => `${s}/skills/${name}/${f}`),
      ),
    );
    exact(r.files, expected, "curated output files");
    validateOutputPaths(expected);
    for (const v of Object.values(r.files)) {
      exact(v, ["sha256", "executable"], "curated output");
      if (
        typeof v.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(v.sha256) ||
        v.executable !== false
      )
        throw new Error("Invalid output digest/mode");
    }
    return r;
  } catch (error) {
    throw libraryError(
      `Invalid curated installation receipt: ${error.message}`,
    );
  }
}
