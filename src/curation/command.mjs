import { loadProject } from "../project/config.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import { libraryError } from "../libraries/definition.mjs";
import { digest } from "../libraries/capture.mjs";
import {
  readLibraryFile,
  preflightLibraryWrites,
  writeLibraryCandidate,
} from "../libraries/io.mjs";
import { curationContext, assertCurationInputs } from "./context.mjs";
import { readBundle, readReview, diffBundles } from "./bundle.mjs";
export async function runCuration(project, mode) {
  if (!["validate", "build", "check", "diff"].includes(mode))
    throw libraryError("Unknown curation operation");
  try {
    const ctx = curationContext(project),
      c = project.curation,
      assertInputs = () => assertCurationInputs(ctx, mode === "build");
    preflightLibraryWrites(
      project,
      ctx.sourceFiles,
      mode === "build",
      "curation",
    );
    const execute = () => {
      assertInputs();
      const accepted =
        ctx.acceptedBytes === null
          ? null
          : readBundle(ctx.acceptedBytes, c.accepted.sha256);
      const base = {
        ok: true,
        artifactStatus: "not-written",
        diagnostics: [],
        sha256: digest(ctx.bytes),
        skillNames: ctx.bundle.skills.map((s) => s.name),
        validationScope: "structure-and-pinned-provenance",
      };
      if (mode === "validate") return base;
      if (mode === "check") {
        if (!accepted || !c.review)
          throw libraryError(
            "Accepted bundle and explicit review pins required",
          );
        readReview(ctx.reviewBytes, c.review.sha256, c.accepted.sha256);
        const ok = ctx.acceptedBytes === ctx.bytes;
        assertInputs();
        return {
          ...base,
          ok,
          diagnostics: ok
            ? []
            : ["Accepted curation differs from current definition/evidence"],
        };
      }
      const previous = readLibraryFile(project, c.candidate, true);
      if (mode === "build") {
        if (previous !== null) readBundle(previous); // Never overwrite an unrelated/damaged file.
        const artifactStatus = writeLibraryCandidate(
          project,
          previous,
          ctx.bytes,
          assertInputs,
          { capability: "curation" },
        );
        return {
          ...base,
          artifactStatus,
          diff: diffBundles(accepted, ctx.bundle),
        };
      }
      if (previous === null)
        throw libraryError("Build a curation candidate before diff");
      const candidate = readBundle(previous);
      if (previous !== ctx.bytes)
        throw libraryError("Candidate does not match current curation inputs");
      assertInputs();
      if (readLibraryFile(project, c.candidate, true) !== previous)
        throw libraryError("Curation candidate changed during diff");
      return { ...base, diff: diffBundles(accepted, candidate) };
    };
    return mode === "build"
      ? await withDirectoryLock(c.lockPath, execute, {
          label: "curated skill bundle",
        })
      : execute();
  } catch (error) {
    if (error.code !== "CURATION_CONTENT_INVALID") throw error;
    return {
      ok: false,
      artifactStatus: "not-written",
      validationScope: "structure-and-pinned-provenance",
      diagnostics: [error.message],
    };
  }
}
export async function runCurationCommand(name, options, rest, json, io) {
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
      scope: "curated-library-skills",
      projectRoot: project.rootDir,
      ...(await runCuration(project, name.split(" ").at(-1))),
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
      "Curation structure/provenance only; semantic accuracy and worked-example execution require explicit review.\n",
    );
  }
  return result.ok ? 0 : 1;
}
