import {
  snapshotTokenInputs,
  assertTokenInputsUnchanged,
} from "./input-snapshot.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import { renderTokenArtifacts } from "./render.mjs";
import {
  preflightTokenWrites,
  assertWritePath,
  writeError,
} from "./write-targets.mjs";

/** Render completely before staging; publish each file by atomic rename. */
export async function buildTokenArtifacts({ project }) {
  preflightTokenWrites(project);
  return withDirectoryLock(
    project.tokens.build.lockPath,
    async () => {
      const targets = preflightTokenWrites(project);
      const inputSnapshot = snapshotTokenInputs(project);
      const { graph, contents } = await renderTokenArtifacts({ project });
      assertTokenInputsUnchanged(project, inputSnapshot);
      preflightTokenWrites(project);
      const pending = [];
      try {
        const artifacts = targets.map(({ id, file }) => {
          const content = contents[id];
          if (typeof content !== "string")
            throw new Error(`Renderer omitted ${id}`);
          const previous = readPrevious(file);
          const unchanged =
            previous?.bytes.equals(Buffer.from(content)) ?? false;
          if (!unchanged) {
            assertWritePath(project.rootDir, file);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const temp = path.join(
              path.dirname(file),
              `.${path.basename(file)}.ds-${crypto.randomUUID()}.tmp`,
            );
            // Remember before creation so write failures do not leave temporary files.
            pending.push({ file, temp });
            fs.writeFileSync(temp, content, {
              flag: "wx",
              mode: previous?.mode ?? 0o644,
            });
            if (previous) fs.chmodSync(temp, previous.mode);
          }
          return {
            id,
            path: path
              .relative(project.rootDir, file)
              .split(path.sep)
              .join("/"),
            status: unchanged ? "unchanged" : "written",
          };
        });
        assertTokenInputsUnchanged(project, inputSnapshot);
        for (const { file, temp } of pending) {
          assertWritePath(project.rootDir, file);
          fs.renameSync(temp, file);
        }
        return { graph, artifacts };
      } catch (error) {
        if (error instanceof CannotEvaluateError) throw error;
        throw writeError("configured token artifacts", error);
      } finally {
        for (const { temp } of pending) fs.rmSync(temp, { force: true });
      }
    },
    { label: "tokens build" },
  );
}
function readPrevious(file) {
  try {
    return {
      bytes: fs.readFileSync(file),
      mode: fs.statSync(file).mode & 0o777,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw writeError(file, error);
  }
}
