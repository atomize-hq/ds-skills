import { loadProject } from "../project/config.mjs";
import { readLibraryFile, preflightLibraryWrites } from "../libraries/io.mjs";
import { captureLibraryEvidence, digest } from "../libraries/capture.mjs";
import { readEvidencePacket } from "../libraries/packet.mjs";
import { libraryError } from "../libraries/definition.mjs";
import { invalid, readCurationDraft } from "./draft.mjs";
import { renderCuration } from "./render.mjs";
import { readBundle } from "./bundle.mjs";
export function curationContext(project) {
  const c = project.curation,
    l = project.libraries;
  if (!c || !l?.evidence)
    throw libraryError("Curation requires configured, pinned library evidence");
  const evidenceBytes = readLibraryFile(project, l.evidence.file),
    evidence = readEvidencePacket(evidenceBytes, l.evidence.sha256),
    current = captureLibraryEvidence(project.rootDir, l.definition);
  if (JSON.stringify(current.data) !== JSON.stringify(evidence.data))
    throw invalid(
      "Library evidence is stale; review and pin updated sources before curating",
    );
  const definitionBytes = readLibraryFile(project, c.definition),
    draft = readCurationDraft(definitionBytes, evidence, l.evidence.sha256),
    bundle = renderCuration(
      draft,
      definitionBytes,
      evidence,
      l.evidence.sha256,
    ),
    bytes = JSON.stringify(bundle, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > 2 * 1024 * 1024)
    throw invalid(
      "Curated bundle exceeds 2 MiB; narrow the evidence and guidance",
    );
  readBundle(bytes);
  const acceptedBytes = c.accepted
      ? readLibraryFile(project, c.accepted.file)
      : null,
    reviewBytes = c.review ? readLibraryFile(project, c.review.file) : null;
  if (c.accepted && digest(acceptedBytes) !== c.accepted.sha256)
    throw libraryError("Accepted curation pin SHA-256 mismatch");
  if (c.review && digest(reviewBytes) !== c.review.sha256)
    throw libraryError("Curation review pin SHA-256 mismatch");
  const sourceFiles = [
    ...current.files,
    l.evidence.file,
    c.definition,
    ...[c.accepted?.file, c.review?.file].filter(Boolean),
  ];
  return {
    project,
    draft,
    bundle,
    bytes,
    sourceFiles,
    acceptedBytes,
    reviewBytes,
    identity: digest(
      JSON.stringify([
        project,
        current.inputIdentity,
        evidenceBytes,
        definitionBytes,
        acceptedBytes,
        reviewBytes,
      ]),
    ),
  };
}
export function assertCurationInputs(initial, writable) {
  const p = initial.project,
    current = curationContext(
      loadProject(p.configPath, { rootDir: p.rootDir }),
    );
  if (current.identity !== initial.identity || current.bytes !== initial.bytes)
    throw libraryError("Curation inputs changed before output commit");
  preflightLibraryWrites(p, current.sourceFiles, writable, "curation");
}
