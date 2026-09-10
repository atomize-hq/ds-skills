import { digest } from "../libraries/capture.mjs";
export function selectSnapshotLibraries(f, bytes) {
  f.write("registry-pinned.json", bytes);
  const pin = { file: "registry-pinned.json", sha256: digest(bytes) };
  const definition = {
    definitionVersion: "1",
    libraries: f.definition.registries.map((r) => ({
      id: r.id,
      source: {
        kind: "registry-snapshot-v1",
        version: r.version,
        snapshot: { ...pin, registry: r.id },
        files: [
          { path: "items/control/ui/control.tsx", role: "source" },
          { path: "items/control/other/control.tsx", role: "source" },
        ],
      },
      components: [
        {
          id: "control",
          kind: "component",
          source: "items/control/ui/control.tsx",
          exportName: "Control",
          importSpecifier: `@example/${r.id}`,
        },
      ],
      ownership: "copied-source",
      capabilities: ["interactive"],
      relationships: [],
      deviations: [],
      conventions: [],
      license: {
        status: "licensed",
        spdx: "LicenseRef-Fixture",
        file: "documents/license",
        attribution: "Fixture author",
        redistribution: "project-only",
      },
    })),
  };
  f.write("libraries.json", definition);
  f.config.libraries = {
    definition: "libraries.json",
    evidence: null,
    candidate: "library-evidence/candidate.json",
    lockPath: ".locks/libraries",
  };
  f.write("project.json", f.config);
  return definition;
}
