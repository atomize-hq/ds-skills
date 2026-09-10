import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { registryFixture } from "../../dist/registries/fixture.mjs";
import { selectSnapshotLibraries } from "../../dist/registries/library-fixture.mjs";
import { digest } from "../../dist/libraries/capture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2),
  f = await registryFixture(
    flavour === "beta" ? { folder: "remote snapshots", withIndex: false } : {},
  );
function run(args, launcher = path.join(f.root, ".ds-skills/project.mjs")) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, ...args], {
      cwd: path.parse(f.root).root,
      env: { ...process.env, DS_SKILLS_PREFIX: prefix },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    const timer = globalThis.setTimeout(() => child.kill("SIGKILL"), 120000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      globalThis.clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}
try {
  const pin = JSON.parse(
    fs.readFileSync(path.join(consumer, "ds-skills.release.json")),
  );
  fs.copyFileSync(
    path.join(consumer, "ds-skills.release.json"),
    path.join(f.root, "ds-skills.release.json"),
  );
  let r = await run(
    ["project", "setup", "--root", f.root, "--prefix", prefix],
    path.join(prefix, pin.release, "lib/bin/ds-skills.mjs"),
  );
  assert.equal(r.code, 0, r.err + r.out);
  const invoke = (mode) =>
    run(["registries", mode, "--config", "project.json", "--json"]);
  assert.equal((await invoke("check")).code, 2);
  r = await invoke("capture");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).registryCount, 2);
  const before = fs.readFileSync(
    path.join(f.root, f.config.registries.candidate),
    "utf8",
  );
  f.write("accepted.json", before);
  f.config.registries.evidence = {
    file: "accepted.json",
    sha256: digest(before),
  };
  f.write("project.json", f.config);
  let requests = f.requests.length;
  assert.equal((await invoke("check")).code, 0);
  assert.equal((await invoke("diff")).code, 0);
  assert.equal(f.requests.length, requests);
  selectSnapshotLibraries(f, before);
  r = await run([
    "libraries",
    "evidence",
    "capture",
    "--config",
    "project.json",
    "--json",
  ]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).libraryCount, 2);
  assert.equal(f.requests.length, requests);
  const libraryBytes = fs.readFileSync(
    path.join(f.root, f.config.libraries.candidate),
    "utf8",
  );
  assert.equal(
    JSON.parse(libraryBytes).data.libraries[0].source.items[0].files.length,
    2,
  );
  f.routes.get("/widgets/control").status = 404;
  r = await invoke("capture");
  assert.equal(r.code, 2, r.err + r.out);
  assert.equal(
    fs.readFileSync(path.join(f.root, f.config.registries.candidate), "utf8"),
    before,
  );
  requests = f.requests.length;
  assert.equal((await invoke("check")).code, 0);
  assert.equal(f.requests.length, requests);
  f.definition.registries[0].version = "review-next-selection";
  f.write("registries.json", f.definition);
  assert.equal((await invoke("check")).code, 1);
  assert.equal(
    fs.readFileSync(path.join(f.root, "accepted.json"), "utf8"),
    before,
  );
  assert.equal(
    f.requests.every(
      (r) =>
        r.headers.authorization === undefined && r.headers.cookie === undefined,
    ),
    true,
  );
  f.config.registries.candidate = "unrelated.tsx";
  f.write("unrelated.tsx", "export const Unrelated = true;\n");
  f.write("project.json", f.config);
  requests = f.requests.length;
  assert.equal((await invoke("capture")).code, 2);
  assert.equal(f.requests.length, requests);
  assert.equal(
    fs.readFileSync(path.join(f.root, "unrelated.tsx"), "utf8"),
    "export const Unrelated = true;\n",
  );
  process.stdout.write(
    `registries: ${flavour} installed configured HTTP capture, offline pin/check/diff, library evidence bridge and 0/1/2 preservation passed\n`,
  );
} finally {
  await f.close();
}
