import { readRegistryDefinition, registryError } from "./definition.mjs";
import { jsonPayload, indexNames, itemSummary } from "./payload.mjs";
import { digest } from "../libraries/capture.mjs";
import { registryClient } from "./http.mjs";
export async function captureRegistries(definitionBytes, options = {}) {
  const definition = readRegistryDefinition(jsonPayload(definitionBytes)),
    client = registryClient(options);
  try {
    // Only the configured index is read. Includes/search/pagination are not traversed.
    const indexes = await client.map(definition.registries, async (r) => {
      if (r.index === null) return null;
      const raw = await client.get(r.index),
        names = indexNames(raw.content);
      if (r.items.some((item) => !names.includes(item.name)))
        throw registryError(
          "Selected item not observed in supplied index; completeness/removal is not inferred",
        );
      return { ...raw, observedNames: names };
    });
    const jobs = definition.registries.flatMap((r, i) => [
      ...r.items.map((item) => ({ i, kind: "item", entry: item })),
      ...r.documents.map((doc) => ({ i, kind: "document", entry: doc })),
    ]);
    const acquired = await client.map(jobs, async (job) => {
      const raw = await client.get(job.entry.url);
      return {
        ...job,
        value:
          job.kind === "item"
            ? {
                name: job.entry.name,
                ...raw,
                ...itemSummary(raw.content, job.entry.name),
              }
            : { id: job.entry.id, ...raw },
      };
    });
    return {
      snapshotVersion: "1",
      scope: "registry-source-snapshot",
      definitionDigest: digest(definitionBytes),
      registries: definition.registries.map((r, i) => ({
        id: r.id,
        declaredVersion: r.version,
        index: indexes[i],
        items: acquired
          .filter((a) => a.i === i && a.kind === "item")
          .map((a) => a.value),
        documents: acquired
          .filter((a) => a.i === i && a.kind === "document")
          .map((a) => a.value),
      })),
    };
  } finally {
    client.close();
  }
}
