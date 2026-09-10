import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

// Execute the actual published entrypoint, with a bounded command that fills an
// OS pipe. In-memory CLI stream mocks cannot detect process.exit truncation.
it.each([0, 1, 2, 3])(
  "drains command output before returning exit %i",
  (status) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-stream-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "bin"));
    fs.mkdirSync(path.join(root, "dist/cli"), { recursive: true });
    const entry = fileURLToPath(
      new URL("../../bin/ds-skills.mjs", import.meta.url),
    );
    fs.copyFileSync(entry, path.join(root, "bin/ds-skills.mjs"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", version: "0.0.0" }),
    );
    const channel = status < 2 ? "stdout" : "stderr";
    const output =
      JSON.stringify({
        command: "stream-test",
        data: "Unicode λ".repeat(65536),
        end: true,
      }) + "\n";
    fs.writeFileSync(
      path.join(root, "dist/cli/run.js"),
      `export async function runCli() { process.${channel}.write(${JSON.stringify(output)}); return ${status}; }`,
    );
    const result = spawnSync(
      process.execPath,
      [path.join(root, "bin/ds-skills.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 10000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    expect(result[channel]).toBe(output);
    expect(result[channel === "stdout" ? "stderr" : "stdout"]).toBe("");
  },
);
