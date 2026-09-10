import { loadProject } from "../project/config.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import { captureLibraryEvidence, digest } from "./capture.mjs";
import { readEvidencePacket, diffLibraryEvidence } from "./packet.mjs";
import { libraryError } from "./definition.mjs";
import {
  readLibraryFile,
  preflightLibraryWrites,
  writeLibraryCandidate,
} from "./io.mjs";
export async function runLibraryEvidence(project, mode) {
  if (!["capture", "check", "diff"].includes(mode))
    throw libraryError("Unknown library evidence operation");
  const c = project.libraries;
  if (!c) throw libraryError("Library evidence is not configured");
  const projectText = JSON.stringify(project);
  const initial = captureLibraryEvidence(project.rootDir, c.definition);
  const assert = () => {
    if (
      JSON.stringify(
        loadProject(project.configPath, { rootDir: project.rootDir }),
      ) !== projectText
    )
      throw libraryError("Project config changed during evidence collection");
    if (c.evidence)
      readEvidencePacket(
        readLibraryFile(project, c.evidence.file),
        c.evidence.sha256,
      );
    const current = captureLibraryEvidence(project.rootDir, c.definition);
    if (
      current.inputIdentity !== initial.inputIdentity ||
      JSON.stringify(current.data) !== JSON.stringify(initial.data)
    )
      throw libraryError("Library sources changed during evidence collection");
    preflightLibraryWrites(project, current.files, mode === "capture");
  };
  preflightLibraryWrites(project, initial.files, mode === "capture");
  const execute = () => {
    assert();
    const pinned = c.evidence
      ? readEvidencePacket(
          readLibraryFile(project, c.evidence.file),
          c.evidence.sha256,
        )
      : null;
    if (mode === "check") {
      if (!pinned) throw libraryError("No reviewed evidence pin is configured");
      const ok = JSON.stringify(pinned.data) === JSON.stringify(initial.data);
      assert();
      return {
        ok,
        artifactStatus: "not-written",
        diagnostics: ok
          ? []
          : ["Pinned evidence differs from current definition/source evidence"],
        sha256: c.evidence.sha256,
      };
    }
    const previous = readLibraryFile(project, c.candidate, true);
    let candidate;
    if (mode === "capture") {
      let existing = null;
      if (previous !== null) {
        try {
          existing = readEvidencePacket(previous);
        } catch {
          throw libraryError(
            "Existing candidate is not a valid evidence packet; preserving it for explicit review",
          );
        }
      }
      candidate =
        existing &&
        JSON.stringify(existing.data) === JSON.stringify(initial.data)
          ? existing
          : { capturedAt: new Date().toISOString(), data: initial.data };
      const bytes = JSON.stringify(candidate, null, 2) + "\n";
      readEvidencePacket(bytes); // Never write a candidate our reader cannot consume.
      const artifactStatus = writeLibraryCandidate(
        project,
        previous,
        bytes,
        assert,
      );
      return {
        ok: true,
        artifactStatus,
        diagnostics: [],
        sha256: digest(bytes),
        libraryCount: candidate.data.libraries.length,
        diff: diffLibraryEvidence(pinned, candidate),
      };
    }
    if (previous === null)
      throw libraryError("Capture a candidate before requesting a diff");
    candidate = readEvidencePacket(previous);
    if (JSON.stringify(candidate.data) !== JSON.stringify(initial.data))
      throw libraryError(
        "Candidate does not match current selected source evidence",
      );
    assert();
    if (readLibraryFile(project, c.candidate, true) !== previous)
      throw libraryError("Candidate changed during diff");
    return {
      ok: true,
      artifactStatus: "not-written",
      diagnostics: [],
      sha256: digest(previous),
      diff: diffLibraryEvidence(pinned, candidate),
    };
  };
  return mode === "capture"
    ? withDirectoryLock(c.lockPath, execute, {
        label: "library evidence capture",
      })
    : execute();
}
export async function runLibrariesCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some((k) => !["config", "root", "json"].includes(k)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw libraryError(`Use ${name} --config <project.json> [--root <dir>]`);
  const project = loadProject(options.config, { rootDir: options.root }),
    result = {
      resultVersion: "1",
      command: name,
      scope: "library-source-evidence",
      projectRoot: project.rootDir,
      ...(await runLibraryEvidence(project, name.split(" ").at(-1))),
    };
  if (json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} ${name}: ${result.artifactStatus}\n`,
    );
    for (const d of result.diagnostics) io.stderr.write(`${d}\n`);
    if (result.diff)
      io.stdout.write(`${JSON.stringify(result.diff, null, 2)}\n`);
    io.stdout.write(
      "Source evidence only; not semantic curation, source removal, license approval, readiness or publication.\n",
    );
  }
  return result.ok ? 0 : 1;
}
