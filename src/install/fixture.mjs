import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releasePlatforms } from "./record.mjs";
import { digestOf } from "./integrity.mjs";
export function installedFixture({ extraFiles = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-pin-"));
  const prefix = path.join(root, "prefix"),
    release = "v0.0.0-fixture",
    sourceCommit = "a".repeat(40);
  const home = path.join(prefix, release);
  const identity = { release, sourceCommit, packageVersion: "0.0.0" };
  const bootstrap = Buffer.from("#!/bin/sh\nprintf installed\\n\n");
  const record = {
    recordVersion: "2",
    repository: "example/design-skills",
    release,
    sourceCommit,
    bootstrap: { asset: "install.sh", sha256: digestOf(bootstrap) },
    bootstrapPowershell: { asset: "install.ps1", sha256: digestOf(bootstrap) },
    checksums: { asset: "SHA256SUMS", sha256: "b".repeat(64) },
    payloadManifest: { asset: "payload-manifest.json", sha256: "c".repeat(64) },
    assets: Object.fromEntries(
      releasePlatforms.map((p) => [
        p,
        {
          asset: `ds-skills-${release}-${p}.${p.startsWith("windows") ? "zip" : "tar.gz"}`,
          sha256: "d".repeat(64),
        },
      ]),
    ),
  };
  const texts = {
    "bin/ds-skills": "#!/bin/sh\necho never-run-during-resolution\n",
    "bin/ds-skills.cmd": "@echo never-run-during-resolution\r\n",
    "lib/bin/ds-skills.mjs":
      'throw new Error("must never execute to identify");\n',
    "lib/release.json": JSON.stringify(identity),
    "lib/skills/RELEASE.json": JSON.stringify(identity),
    "lib/package.json": '{"type":"module"}',
    "lib/dist/module.js": "export const value = 1;\n",
    "lib/skills/example/SKILL.md": "# Source-grounded skill\n",
    ...extraFiles,
  };
  for (const [file, bytes] of Object.entries(texts)) {
    const target = path.join(home, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, {
      mode: file.startsWith("bin/") ? 0o755 : 0o644,
    });
  }
  const manifest = { manifestVersion: "1", release, sourceCommit, files: {} };
  const recordPath = path.join(root, "reviewed.json");
  const save = () => {
    const bytes = Buffer.from(JSON.stringify(manifest));
    fs.writeFileSync(path.join(home, "payload-manifest.json"), bytes);
    record.payloadManifest.sha256 = digestOf(bytes);
    fs.writeFileSync(recordPath, JSON.stringify(record));
  };
  const seal = () => {
    const files = [];
    const visit = (directory, relative = "") => {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${item.name}` : item.name;
        if (name === "payload-manifest.json") continue;
        if (item.isDirectory()) visit(path.join(directory, item.name), name);
        else files.push(name);
      }
    };
    visit(home);
    manifest.files = Object.fromEntries(
      files.sort().map((file) => [
        file,
        {
          sha256: digestOf(fs.readFileSync(path.join(home, file))),
          executable: Boolean(fs.statSync(path.join(home, file)).mode & 0o111),
        },
      ]),
    );
    save();
  };
  seal();
  return {
    root,
    prefix,
    home,
    record,
    recordPath,
    manifest,
    bootstrap,
    save,
    seal,
  };
}
