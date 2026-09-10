import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

/** Include upstream license/notice files for every package read by the bundler. */
export function writeBundleNotices(metadata, root, destination) {
  const supplementsRoot = path.join(root, "licenses/compiler");
  const supplements = JSON.parse(
    fs.readFileSync(path.join(supplementsRoot, "supplemental.json"), "utf8"),
  );
  const packages = new Map();
  for (const input of Object.keys(metadata.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let current = path.dirname(path.resolve(root, input));
    while (current !== root && current !== path.dirname(current)) {
      const file = path.join(current, "package.json");
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.name && data.version) {
          packages.set(`${data.name}@${data.version}`, { dir: current, data });
          break;
        }
      }
      current = path.dirname(current);
    }
  }
  // These published mirrors omit standalone license files. Preserve their exact
  // SPDX/author declarations AND include their upstream dependency notices.
  // Do not fabricate a copyright statement or silently accept new omissions.
  const mirrorDeclarations = new Map([
    ["@bundled-es-modules/deepmerge@4.3.2", "MIT"],
    ["path-unified@0.2.0", "MIT"],
    ["@bundled-es-modules/glob@13.0.6", "MIT"],
    ["@bundled-es-modules/memfs@4.17.0", "Apache-2.0"],
    ["@bundled-es-modules/postcss-calc-ast-parser@0.1.6", "ISC"],
  ]);
  const embeddedNames = new Set();
  for (const input of Object.keys(metadata.inputs)) {
    if (!input.includes("@bundled-es-modules")) continue;
    const text = fs.readFileSync(path.resolve(root, input), "utf8");
    for (const match of text.matchAll(
      /\/\/ node_modules\/(@[^/]+\/[^/]+|[^/]+)\//g,
    ))
      embeddedNames.add(match[1]);
  }
  const visited = new Set();
  function addDependencies(dir, data) {
    const id = `${data.name}@${data.version}`;
    if (visited.has(id)) return;
    visited.add(id);
    for (const name of Object.keys(data.dependencies ?? {})) {
      if (!embeddedNames.has(name)) continue;
      const dependencyDir = findDependency(dir, name);
      const dependency = JSON.parse(
        fs.readFileSync(path.join(dependencyDir, "package.json"), "utf8"),
      );
      packages.set(`${dependency.name}@${dependency.version}`, {
        dir: dependencyDir,
        data: dependency,
      });
      addDependencies(dependencyDir, dependency);
    }
  }
  for (const [id, { dir, data }] of [...packages])
    if (mirrorDeclarations.has(id)) addDependencies(dir, data);
  const sections = [
    "Third-party compiler package notices and supplementary upstream dependency notices.",
    "Prebundled mirrors do not expose a complete original-version package graph; supplemental notice versions identify the pinned dependency tree consulted, not an original SBOM claim.",
    "Unmodified library sources are bundled; the integration adapter is maintained by ds-skills.",
  ];
  for (const [id, { dir, data }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const files = fs
      .readdirSync(dir)
      .filter((name) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name))
      .sort();
    const supplement = supplements[id];
    const inlineLicense =
      id === "stream@0.0.3"
        ? fs.readFileSync(path.join(dir, "index.js"), "utf8").split("\n\n")[0]
        : null;
    if (
      inlineLicense &&
      !inlineLicense.includes("USE OR OTHER DEALINGS IN THE SOFTWARE")
    )
      throw new Error("Unexpected stream license header");
    if (
      !files.length &&
      !supplement &&
      !inlineLicense &&
      mirrorDeclarations.get(id) !== data.license
    )
      throw new Error(`No license text found for bundled dependency ${id}`);
    sections.push(
      `\n===== ${id} (${typeof data.license === "string" ? data.license : JSON.stringify(data.license)}) =====`,
    );
    if (!files.length && !supplement && !inlineLicense)
      sections.push(
        `Published package has no standalone license file. Package declaration: ${JSON.stringify({ name: data.name, version: data.version, license: data.license, author: data.author })}. Upstream dependency notices are included in this document; retained source comments are in compiler.mjs.LEGAL.txt.`,
      );
    if (inlineLicense)
      sections.push(
        `License from published index.js header:\n${inlineLicense}`,
      );
    if (supplement) {
      const bytes = fs.readFileSync(
        path.join(supplementsRoot, supplement.file),
      );
      if (
        crypto.createHash("sha256").update(bytes).digest("hex") !==
        supplement.sha256
      )
        throw new Error(`License supplement digest mismatch: ${id}`);
      sections.push(
        `License from published revision: ${supplement.source}\n${bytes.toString("utf8")}`,
      );
    }
    for (const file of files)
      if (fs.statSync(path.join(dir, file)).isFile())
        sections.push(
          `--- ${file} ---\n${fs.readFileSync(path.join(dir, file), "utf8")}`,
        );
  }
  fs.writeFileSync(destination, sections.join("\n") + "\n");
}

function findDependency(from, name) {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json")))
      return fs.realpathSync(candidate);
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot resolve notice dependency ${name} from ${from}`);
}
