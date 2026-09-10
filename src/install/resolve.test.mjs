import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveRelease, installPrefix } from "./resolve.mjs";
import { readReleaseRecord, platformKey } from "./record.mjs";
import { installedFixture } from "./fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = installedFixture();
  roots.push(f.root);
  return f;
}
function resolve(f) {
  return resolveRelease({
    recordPath: f.recordPath,
    prefix: f.prefix,
    platform: "linux",
    arch: "x64",
  });
}
it("resolves only sealed files at the version-specific path without executing any code", () => {
  const f = fixture();
  const result = resolve(f);
  expect(result.ok).toBe(true);
  expect(result.executable).toBe(path.join(f.home, "bin/ds-skills"));
  expect(result.sourceCommit).toBe(f.record.sourceCommit);
  expect(result.diagnostics).toEqual([]);
});
it.each([
  "lib/dist/module.js",
  "lib/skills/example/SKILL.md",
  "bin/ds-skills",
  "lib/release.json",
])(
  "rejects edited installed content with unchanged version labels: %s",
  (file) => {
    const f = fixture();
    fs.appendFileSync(path.join(f.home, file), "\nchanged");
    expect(resolve(f).diagnostics).toContainEqual(
      expect.objectContaining({ code: "RELEASE_CONTENT_DIGEST", path: file }),
    );
  },
);
it("rejects a rewritten manifest even if it matches tampered files", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.home, "lib/dist/module.js"), "changed");
  f.manifest.files["lib/dist/module.js"].sha256 = "e".repeat(64);
  fs.writeFileSync(
    path.join(f.home, "payload-manifest.json"),
    JSON.stringify(f.manifest),
  );
  expect(resolve(f).diagnostics[0].code).toBe("RELEASE_MANIFEST_DIGEST");
});
it.each([
  "lib/skills/example/SKILL.md",
  "lib/release.json",
  "bin/ds-skills",
  "payload-manifest.json",
])("rejects missing installed content: %s", (file) => {
  const f = fixture();
  fs.unlinkSync(path.join(f.home, file));
  expect(resolve(f).ok).toBe(false);
});
it("rejects injected modules not listed in the sealed payload", () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.home, "lib/node_modules"));
  fs.writeFileSync(
    path.join(f.home, "lib/node_modules/injection.js"),
    "throw 1;",
  );
  expect(resolve(f).diagnostics[0].code).toBe("RELEASE_CONTENT_EXTRA");
});
it("rejects unexpected files without following executable-looking content", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.home, "injection.mjs"), "throw 1;");
  expect(resolve(f).diagnostics[0].code).toBe("RELEASE_CONTENT_EXTRA");
});
it("rejects payload symlinks even to byte-identical internal files", () => {
  const f = fixture();
  const target = path.join(f.home, "lib/dist/module.js");
  fs.unlinkSync(target);
  fs.symlinkSync("../package.json", target);
  expect(
    resolve(f).diagnostics.some((d) => d.code === "RELEASE_CONTENT_LINK"),
  ).toBe(true);
});
it("rejects a symlinked release home", () => {
  const f = fixture();
  fs.renameSync(f.home, `${f.home}-real`);
  fs.symlinkSync(`${f.home}-real`, f.home);
  expect(resolve(f).diagnostics[0].code).toBe("RELEASE_HOME_KIND");
});
it("rejects a nonexecutable launcher on POSIX", () => {
  const f = fixture();
  fs.chmodSync(path.join(f.home, "bin/ds-skills"), 0o644);
  expect(resolve(f).diagnostics[0].code).toBe("RELEASE_EXECUTABLE_MODE");
});
it.each(["lib/release.json", "lib/skills/RELEASE.json"])(
  "checks sealed identity consistency in %s",
  (file) => {
    const f = fixture();
    fs.writeFileSync(
      path.join(f.home, file),
      JSON.stringify({
        release: "v9.0.0",
        sourceCommit: f.record.sourceCommit,
      }),
    );
    f.seal();
    expect(resolve(f).ok).toBe(false);
    expect(resolve(f).diagnostics[0].code).toMatch(/IDENTITY|SKEW/);
  },
);
it("rejects a sealed manifest with path traversal before reading outside the install", () => {
  const f = fixture();
  f.manifest.files["../outside"] = {
    sha256: "a".repeat(64),
    executable: false,
  };
  f.save();
  expect(resolve(f).diagnostics[0].code).toBe("RELEASE_MANIFEST_INVALID");
});
it("does not resolve an absent install from an ambient executable", () => {
  const f = fixture();
  fs.rmSync(f.home, { recursive: true });
  expect(() => resolve(f)).toThrow(/no PATH fallback/);
});
it.each([
  ["recordVersion", "1"],
  ["release", "../../unsafe"],
  ["sourceCommit", "HEAD"],
  ["repository", "../elsewhere"],
  ["payloadManifest", null],
  ["bootstrap", { asset: "../install.sh", sha256: "a".repeat(64) }],
])("rejects malformed or legacy records: %s", (key, value) => {
  const f = fixture();
  f.record[key] = value;
  fs.writeFileSync(f.recordPath, JSON.stringify(f.record));
  expect(() => readReleaseRecord(f.recordPath)).toThrow();
});
it.each([
  ["darwin", "arm64", "macos_arm64"],
  ["darwin", "x64", "macos_x86_64"],
  ["linux", "x64", "linux_x86_64"],
  ["linux", "arm64", "linux_aarch64"],
  ["win32", "x64", "windows_x86_64"],
])("maps %s/%s to its actual published key", (platform, arch, key) => {
  expect(platformKey(platform, arch)).toBe(key);
});
it.each([
  ["win32", "arm64"],
  ["linux", "ppc64"],
  ["sunos", "x64"],
])(
  "does not silently offer an untested emulation target: %s/%s",
  (platform, arch) => {
    expect(() => platformKey(platform, arch)).toThrow(/No tested release/);
  },
);
it("resolves configured install locations without a consumer-specific name", () => {
  expect(installPrefix({ HOME: "/example" }, "linux")).toBe(
    "/example/.local/share/ds-skills",
  );
  expect(installPrefix({ DS_SKILLS_PREFIX: "/job/tools" })).toBe("/job/tools");
  expect(installPrefix({ LOCALAPPDATA: "/windows-data" }, "win32")).toBe(
    "/windows-data/ds-skills",
  );
});
