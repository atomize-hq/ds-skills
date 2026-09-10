import fs from "node:fs";
import path from "node:path";
import { libraryFixture } from "../libraries/fixture.mjs";
import { runLibraryEvidence } from "../libraries/command.mjs";
import { digest } from "../libraries/capture.mjs";
import { categories } from "./draft.mjs";
export async function curationFixture(options = {}) {
  const f = libraryFixture(options);
  await runLibraryEvidence(f.project(), "capture");
  const evidenceBytes = fs.readFileSync(
      path.join(f.root, f.config.libraries.candidate),
      "utf8",
    ),
    evidence = JSON.parse(evidenceBytes);
  f.write("evidence/pinned.json", evidenceBytes);
  f.config.libraries.evidence = {
    file: "evidence/pinned.json",
    sha256: digest(evidenceBytes),
  };
  const draft = {
    curationVersion: "1",
    namespace: options.namespace ?? "demo",
    evidenceSha256: digest(evidenceBytes),
    skills: evidence.data.libraries.map((l) => {
      const source = l.files.find((s) => s.roles.includes("source")),
        citation = {
          library: l.id,
          file: source.path,
          sha256: source.sha256,
          start: 1,
          end: 2,
        },
        api = { library: l.id, id: "control" };
      return {
        id: l.id,
        description: `Use ${l.id} controls with caller-owned action handling.`,
        libraries: [l.id],
        sections: categories.map((category) => ({
          id: category,
          title: category,
          category,
          text: `Fixture ${category}: inspect the selected Control declaration and caller-owned action callback.`,
          citations: [citation],
          components: category === "api" ? [api] : [],
        })),
        examples: [
          {
            id: "controlled-action",
            title: "Caller-owned action",
            language: "tsx",
            code: `import { Control } from "@example/${l.id}";\nexport function Example() { return <Control label="Run" onAction={() => {}} />; }`,
            citations: [citation],
            components: [api],
          },
        ],
      };
    }),
  };
  f.config.curation = {
    definition: "curation.json",
    candidate: "curation-evidence/candidate.json",
    accepted: null,
    review: null,
    lockPath: ".locks/curation",
  };
  f.write("project.json", f.config);
  f.write("curation.json", draft);
  return { ...f, draft, evidence };
}
export function acceptFixtureCuration(f, bytes) {
  f.write("curation-evidence/accepted.json", bytes);
  const sha256 = digest(bytes),
    review = {
      reviewVersion: "1",
      bundleSha256: sha256,
      decision: "approved",
      reviewer: { kind: "agent", id: "fixture-only" },
      reviewedAt: "2026-09-09T00:00:00.000Z",
      notes: "Fixture acceptance; not actual semantic review evidence.",
    },
    reviewBytes = JSON.stringify(review, null, 2) + "\n";
  f.write("curation-evidence/review.json", reviewBytes);
  f.config.curation.accepted = {
    file: "curation-evidence/accepted.json",
    sha256,
  };
  f.config.curation.review = {
    file: "curation-evidence/review.json",
    sha256: digest(reviewBytes),
  };
  f.write("project.json", f.config);
}
