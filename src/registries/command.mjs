import { loadProject } from "../project/config.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import { digest } from "../libraries/capture.mjs";
import { readLibraryDefinition } from "../libraries/definition.mjs";
import {
  readLibraryFile,
  preflightLibraryWrites,
  writeLibraryCandidate,
} from "../libraries/io.mjs";
import { registryError, readRegistryDefinition } from "./definition.mjs";
import { jsonPayload } from "./payload.mjs";
import { captureRegistries } from "./capture.mjs";
import {
  readRegistryPacket,
  snapshotMatchesDefinition,
  diffRegistrySnapshots,
} from "./packet.mjs";
const MAX = 16 * 1024 * 1024;
export async function runRegistryEvidence(project, mode, options = {}) {
  if (!["capture", "check", "diff"].includes(mode))
    throw registryError("Unknown operation");
  const c = project.registries;
  if (!c) throw registryError("Registry acquisition is not configured");
  const config = JSON.stringify(project),
    definition = readLibraryFile(project, c.definition);
  readRegistryDefinition(jsonPayload(definition));
  const read = (file, missing = false) =>
    readLibraryFile(project, file, missing, MAX);
  const pinned = () =>
    c.evidence
      ? readRegistryPacket(read(c.evidence.file), c.evidence.sha256)
      : null;
  function assertInputs() {
    if (
      JSON.stringify(
        loadProject(project.configPath, { rootDir: project.rootDir }),
      ) !== config ||
      readLibraryFile(project, c.definition) !== definition
    )
      throw registryError("Config/selection changed during acquisition");
    pinned();
    const libraryInputs = project.libraries
      ? readLibraryDefinition(
          jsonPayload(readLibraryFile(project, project.libraries.definition)),
          project.rootDir,
        ).libraries.flatMap((l) =>
          l.source.kind === "registry-snapshot-v1"
            ? [l.source.snapshot.file]
            : [
                ...l.source.files.map((f) => f.path),
                l.source.manifest,
                l.license.file,
              ].filter(Boolean),
        )
      : [];
    preflightLibraryWrites(
      project,
      [c.definition, ...libraryInputs],
      mode === "capture",
      "registries",
    );
  }
  assertInputs();
  const execute = async () => {
    assertInputs();
    const accepted = pinned();
    if (mode === "check") {
      if (!accepted)
        throw registryError("No accepted registry snapshot pin configured");
      const ok = snapshotMatchesDefinition(accepted, definition);
      assertInputs();
      return {
        ok,
        artifactStatus: "not-written",
        diagnostics: ok
          ? []
          : ["Accepted registry snapshot selection is stale"],
        sha256: c.evidence.sha256,
      };
    }
    const before = read(c.candidate, true);
    let candidate;
    if (mode === "capture") {
      let prior = null;
      if (before !== null)
        try {
          prior = readRegistryPacket(before);
        } catch {
          throw registryError(
            "Existing candidate is not a valid snapshot; preserving it for explicit review",
          );
        }
      const data = await captureRegistries(definition, options);
      candidate =
        prior && JSON.stringify(prior.data) === JSON.stringify(data)
          ? prior
          : { capturedAt: new Date().toISOString(), data };
      const bytes = JSON.stringify(candidate, null, 2) + "\n";
      readRegistryPacket(bytes);
      const artifactStatus = writeLibraryCandidate(
        project,
        before,
        bytes,
        assertInputs,
        { capability: "registries", maxBytes: MAX },
      );
      return {
        ok: true,
        artifactStatus,
        diagnostics: [],
        sha256: digest(bytes),
        registryCount: data.registries.length,
        diff: diffRegistrySnapshots(accepted, candidate),
      };
    }
    if (before === null) throw registryError("Capture a candidate before diff");
    candidate = readRegistryPacket(before);
    if (!snapshotMatchesDefinition(candidate, definition))
      throw registryError("Candidate does not match current selection");
    assertInputs();
    if (read(c.candidate, true) !== before)
      throw registryError("Candidate changed during diff");
    return {
      ok: true,
      artifactStatus: "not-written",
      diagnostics: [],
      sha256: digest(before),
      diff: diffRegistrySnapshots(accepted, candidate),
    };
  };
  return mode === "capture"
    ? withDirectoryLock(c.lockPath, execute, {
        label: "registry source capture",
      })
    : execute();
}
export async function runRegistryCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some((k) => !["config", "root", "json"].includes(k)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw registryError(`Use ${name} --config <project.json> [--root <dir>]`);
  const project = loadProject(options.config, { rootDir: options.root }),
    result = {
      resultVersion: "1",
      command: name,
      scope: "registry-source-snapshot",
      projectRoot: project.rootDir,
      ...(await runRegistryEvidence(project, name.split(" ").at(-1))),
    };
  if (json) io.stdout.write(JSON.stringify(result) + "\n");
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} ${name}: ${result.artifactStatus}\n`,
    );
    for (const d of result.diagnostics) io.stderr.write(d + "\n");
    if (result.diff)
      io.stdout.write(JSON.stringify(result.diff, null, 2) + "\n");
    io.stdout.write(
      "Snapshot evidence only; offline checks do not assert current upstream freshness, removal, license approval, or curated skill correctness.\n",
    );
  }
  return result.ok ? 0 : 1;
}
