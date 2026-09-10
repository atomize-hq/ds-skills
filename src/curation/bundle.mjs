import { exact, id, text, libraryError } from "../libraries/definition.mjs";
import { digest } from "../libraries/capture.mjs";
import { renderer } from "./render.mjs";
export function readBundle(bytes, sha256 = null) {
  if (sha256 !== null && digest(bytes) !== sha256)
    throw libraryError("Curated bundle SHA-256 mismatch");
  let b;
  try {
    b = JSON.parse(bytes);
  } catch {
    throw libraryError("Invalid curated bundle JSON");
  }
  exact(
    b,
    [
      "bundleVersion",
      "scope",
      "renderer",
      "evidenceSha256",
      "definitionSha256",
      "namespace",
      "skills",
    ],
    "curated bundle",
  );
  if (
    b.bundleVersion !== "1" ||
    b.scope !== "curated-library-skills" ||
    b.renderer !== renderer ||
    !id(b.namespace) ||
    b.namespace.length > 20 ||
    [b.evidenceSha256, b.definitionSha256].some(
      (v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v),
    ) ||
    !Array.isArray(b.skills) ||
    !b.skills.length ||
    b.skills.length > 40
  )
    throw libraryError("Unsupported curated bundle");
  const names = new Set();
  for (const s of b.skills) {
    exact(s, ["name", "files"], "bundled skill");
    if (
      !id(s.name) ||
      s.name.length > 63 ||
      !s.name.startsWith(`ds-curated-${b.namespace}-`) ||
      names.has(s.name)
    )
      throw libraryError("Invalid/duplicate curated skill name");
    names.add(s.name);
    exact(
      s.files,
      ["SKILL.md", "references/guidance.md", "references/evidence.json"],
      "bundled files",
    );
    for (const file of [
      "SKILL.md",
      "references/guidance.md",
      "references/evidence.json",
    ])
      if (
        !text(s.files[file]?.trim()) ||
        Buffer.byteLength(s.files[file]) > 1024 * 1024
      )
        throw libraryError("Invalid curated file");
  }
  return b;
}
export function readReview(bytes, expected, bundleHash) {
  if (digest(bytes) !== expected)
    throw libraryError("Curation review SHA-256 mismatch");
  let r;
  try {
    r = JSON.parse(bytes);
  } catch {
    throw libraryError("Invalid review JSON");
  }
  exact(
    r,
    [
      "reviewVersion",
      "bundleSha256",
      "decision",
      "reviewer",
      "reviewedAt",
      "notes",
    ],
    "curation review",
  );
  exact(r.reviewer, ["kind", "id"], "reviewer");
  if (
    r.reviewVersion !== "1" ||
    r.bundleSha256 !== bundleHash ||
    r.decision !== "approved" ||
    !["human", "agent"].includes(r.reviewer.kind) ||
    !text(r.reviewer.id) ||
    !text(r.notes) ||
    typeof r.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(r.reviewedAt)) ||
    new Date(r.reviewedAt).toISOString() !== r.reviewedAt
  )
    throw libraryError(
      "Review must explicitly approve these exact bundle bytes with reviewer identity and notes",
    );
  return r;
}
export function diffBundles(previous, next) {
  const a = new Map((previous?.skills ?? []).map((s) => [s.name, s])),
    b = new Map(next.skills.map((s) => [s.name, s]));
  return {
    evidenceChanged: previous?.evidenceSha256 !== next.evidenceSha256,
    definitionChanged: previous?.definitionSha256 !== next.definitionSha256,
    added: [...b.keys()].filter((n) => !a.has(n)),
    noLongerSelected: [...a.keys()].filter((n) => !b.has(n)),
    changed: [...b.keys()].filter(
      (n) => a.has(n) && JSON.stringify(a.get(n)) !== JSON.stringify(b.get(n)),
    ),
  };
}
