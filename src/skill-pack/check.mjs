import fs from "node:fs";
import path from "node:path";
export const coreSkills = [
  "curate-component-libraries",
  "interactive-workspace-builder",
  "library-component-builder",
  "stack-orchestrator",
  "stage-1-foundation-primitives-system",
  "stage-2-component-roundtrip-loop",
  "stage-3-organism-layout-assembler",
  "storybook-rigorous-spec-system",
  "sync-quality-governor",
];
/** Pack authoring/layout checks only. This does not certify prose or consumer readiness. */
export function checkSkillPack(root) {
  const diagnostics = [],
    files = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name),
        info = fs.lstatSync(file);
      if (info.isSymbolicLink())
        throw new Error(`Symbolic skill asset: ${file}`);
      if (info.isDirectory()) walk(file);
      else if (info.isFile()) files.push(file);
      else throw new Error(`Non-regular skill asset: ${file}`);
    }
  }
  const names = fs
    .readdirSync(path.join(root, "skills"))
    .filter((n) => n !== "RELEASE.json")
    .sort();
  // Installed consumers can have unrelated/custom skills; inspect only core roots.
  for (const name of coreSkills) {
    if (!names.includes(name)) {
      diagnostics.push(`Missing core skill: ${name}`);
      continue;
    }
    const folder = path.join(root, "skills", name);
    walk(folder);
    const entry = path.join(folder, "SKILL.md");
    if (!fs.existsSync(entry)) {
      diagnostics.push(`Missing entrypoint: ${name}`);
      continue;
    }
    const text = fs.readFileSync(entry, "utf8");
    const frontmatter = text.match(
      /^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/,
    );
    if (!frontmatter || frontmatter[1] !== name)
      diagnostics.push(`Invalid core frontmatter: ${name}`);
    else {
      try {
        if (
          typeof JSON.parse(frontmatter[2]) !== "string" ||
          JSON.parse(frontmatter[2]).length < 20
        )
          throw new Error();
      } catch {
        diagnostics.push(
          `Core description must be a quoted nonempty string: ${name}`,
        );
      }
    }
    if (text.split("\n").length > 120)
      diagnostics.push(
        `Move conditional detail out of core entrypoint: ${name}`,
      );
    const metadata = path.join(folder, "agents/openai.yaml");
    if (
      fs.existsSync(metadata) &&
      !fs.readFileSync(metadata, "utf8").includes(`$${name}`)
    )
      diagnostics.push(`Metadata does not invoke its own skill: ${name}`);
  }
  for (const group of ["schemas", "templates"]) walk(path.join(root, group));
  for (const file of files.filter((f) => /\.(md|yaml|json)$/.test(f))) {
    const text = fs.readFileSync(file, "utf8");
    if (/code[ _-]?connect|pilot|CT-11B|figma:connect:/i.test(text))
      diagnostics.push(`Retired workflow in ${path.relative(root, file)}`);
    if (
      /\/Users\/|\/home\/|src\/components\/|src-tauri\/|design-tokens\/src\/|pnpm validate:|just check/.test(
        text,
      )
    )
      diagnostics.push(
        `Consumer-specific path/command in ${path.relative(root, file)}`,
      );
    if (file.endsWith(".md"))
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|#)/.test(target)) continue;
        const resolved = path.resolve(path.dirname(file), target.split("#")[0]),
          rel = path.relative(root, resolved);
        if (
          rel === ".." ||
          rel.startsWith(`..${path.sep}`) ||
          path.isAbsolute(rel) ||
          !fs.existsSync(resolved)
        )
          diagnostics.push(
            `Broken/escaping skill reference: ${path.relative(root, file)} -> ${target}`,
          );
      }
  }
  return {
    ok: !diagnostics.length,
    scope: "core-skill-authoring-and-layout",
    skills: coreSkills,
    diagnostics,
  };
}
