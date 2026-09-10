import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadProject } from "../project/config.mjs";
export function libraryFixture({
  folder = "packages",
  secondKind = "local-package-v1",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "library-evidence-"));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  };
  const libraries = ["widgets", "layout"].map((id, index) => {
    const prefix = `${folder}/${id}`,
      kind = index === 1 ? secondKind : "local-package-v1";
    write(`${prefix}/package.json`, {
      name: `@example/${id}`,
      version: "1.2.3",
      private: true,
      exports: "./index.tsx",
      peerDependencies: { react: "^19.0.0" },
      scripts: { postinstall: "DO NOT EXECUTE EVIDENCE" },
    });
    write(
      `${prefix}/index.tsx`,
      "export interface Props { label: string; onAction(): void; }\nexport function Control(props: Props) { return <button onClick={props.onAction}>{props.label}</button>; }\n",
    );
    write(
      `${prefix}/README.md`,
      "# Composition\nThe caller supplies action handling.\n",
    );
    return {
      id,
      source: {
        kind,
        version: kind === "local-package-v1" ? "1.2.3" : "copied-revision-one",
        manifest: kind === "local-package-v1" ? `${prefix}/package.json` : null,
        package:
          kind === "local-package-v1"
            ? { name: `@example/${id}`, version: "1.2.3" }
            : null,
        revision: { mode: "content", commit: null },
        files: [
          { path: `${prefix}/index.tsx`, role: "source" },
          { path: `${prefix}/README.md`, role: "documentation" },
        ],
      },
      components: [
        {
          id: "control",
          kind: "component",
          source: `${prefix}/index.tsx`,
          exportName: "Control",
          importSpecifier: `@example/${id}`,
        },
      ],
      ownership: kind === "local-package-v1" ? "dependency" : "copied-source",
      capabilities: ["interactive"],
      relationships: index
        ? [
            {
              library: "widgets",
              kind: "composes",
              description: "Explicit composition relationship for review",
            },
          ]
        : [],
      deviations: [],
      conventions: [
        {
          id: "caller-actions",
          text: "Actions belong to the caller",
          evidence: [{ file: `${prefix}/README.md`, start: 2, end: 2 }],
        },
      ],
      license: {
        status: "project-private",
        spdx: null,
        file: null,
        attribution: "Project-owned fixture code",
        redistribution: "project-only",
      },
    };
  });
  const definition = { definitionVersion: "1", libraries };
  const config = {
    projectVersion: "1",
    tokens: null,
    libraries: {
      definition: "libraries.json",
      evidence: null,
      candidate: "evidence/candidate.json",
      lockPath: ".locks/libraries",
    },
  };
  write("libraries.json", definition);
  write("project.json", config);
  const git = (args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Evidence Test",
        "-c",
        "user.email=evidence@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgsign=false",
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: Object.fromEntries(
          Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
        ),
      },
    );
  const commit = () => {
    git(["init", "-q"]);
    git(["add", folder]);
    git(["commit", "-qm", "Fixture sources"]);
    const sha = git(["rev-parse", "HEAD"]).trim();
    for (const l of libraries)
      l.source.revision = { mode: "committed", commit: sha };
    write("libraries.json", definition);
    return sha;
  };
  return {
    root,
    write,
    definition,
    config,
    commit,
    git,
    project: () => loadProject(path.join(root, "project.json")),
  };
}
