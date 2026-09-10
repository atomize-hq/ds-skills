import path from "node:path";
import { loadProject } from "../project/config.mjs";
import { captureContract, matchProvider } from "./contract-inputs.mjs";
import { sourceError } from "./inputs.mjs";
export function checkSourceContract(project) {
  if (
    JSON.stringify(
      loadProject(project.configPath, { rootDir: project.rootDir }),
    ) !== JSON.stringify(project)
  )
    throw sourceError("Project configuration changed");
  const config = project.sourceChecks?.contract,
    captured = captureContract(project);
  const { providers, parsed, consumers } = captured,
    errors = [],
    usage = [],
    consumedFiles = new Set();
  const rel = (f) =>
    path.relative(project.rootDir, f).split(path.sep).join("/");
  for (const p of config.providers)
    if (!providers.get(p.id).size)
      errors.push(`[CONTRACT_SCOPE_EMPTY] No provider modules: ${p.id}`);
  if (!consumers.size)
    errors.push("[CONTRACT_SCOPE_EMPTY] No consumer modules");
  for (const file of consumers)
    for (const imported of parsed.get(file).imports) {
      const provider = matchProvider(imported.specifier, config.providers);
      if (!provider) continue;
      if (imported.unsupported)
        throw sourceError(
          `Namespace/dynamic/CommonJS imports from selected providers are unsupported: ${rel(file)}`,
        );
      let key =
        imported.specifier === provider.modulePrefix
          ? provider.entrypoint
          : imported.specifier.slice(provider.modulePrefix.length + 1);
      if (key !== null) key = key.replace(/(?:\.d)?\.(?:tsx?|js)$/, "");
      if (
        key === null ||
        key.split("/").some((s) => !s || s === "." || s === "..")
      )
        throw sourceError(
          `Unresolved selected provider import: ${imported.specifier}`,
        );
      const target = providers.get(provider.id).get(key);
      consumedFiles.add(file);
      usage.push({
        consumer: rel(file),
        provider: provider.id,
        module: key,
        bindings: imported.bindings,
      });
      if (!target) {
        errors.push(
          `[CONTRACT_MODULE_MISSING] ${rel(file)} imports missing ${provider.id}/${key}`,
        );
        continue;
      }
      const exported = new Map(parsed.get(target).exports);
      for (const binding of imported.bindings) {
        if (!exported.has(binding.name)) {
          if (parsed.get(target).wildcard)
            throw sourceError(
              `Cannot enumerate wildcard exports of ${rel(target)}`,
            );
          errors.push(
            `[CONTRACT_EXPORT_MISSING] ${rel(target)} does not export ${binding.name}, imported by ${rel(file)}`,
          );
        } else if (!binding.typeOnly && exported.get(binding.name) === "type")
          errors.push(
            `[CONTRACT_TYPE_ONLY_EXPORT] ${rel(file)} requires runtime ${binding.name} but ${rel(target)} only exports a type`,
          );
      }
    }
  const slots = [];
  if (config.slots.mode === "filename-prefix") {
    const names = new Map();
    for (const file of parsed.keys()) {
      const name = path.basename(file).replace(/(?:\.d)?\.tsx?$/, "");
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(file);
      if (parsed.get(file).dynamicSelectors)
        throw sourceError(
          `Dynamic slot selectors are unsupported: ${rel(file)}`,
        );
    }
    for (const [slot, owner] of Object.entries(config.slots.owners))
      if (!parsed.has(owner))
        errors.push(
          `[CONTRACT_SLOT_OWNER_MISSING] Explicit owner for ${slot} is outside selected source files`,
        );
    for (const [file, data] of parsed)
      for (const slot of data.selected) {
        const prefix = [...names.keys()]
          .filter((n) => slot === n || slot.startsWith(`${n}-`))
          .sort((a, b) => b.length - a.length)[0];
        const owners = Object.hasOwn(config.slots.owners, slot)
          ? [config.slots.owners[slot]]
          : (names.get(prefix) ?? []);
        if (owners.length !== 1) {
          errors.push(
            `[CONTRACT_SLOT_${owners.length ? "AMBIGUOUS" : "UNOWNED"}] ${slot} selected by ${rel(file)} has ${owners.length} candidate owners`,
          );
          continue;
        }
        const owner = owners[0],
          source = parsed.get(owner);
        slots.push({ slot, selectedBy: rel(file), owner: rel(owner) });
        if (source?.dynamicSlots && !source.declared.includes(slot))
          throw sourceError(
            `Cannot resolve dynamic slot declaration in ${rel(owner)}`,
          );
        if (!source?.declared.includes(slot))
          errors.push(
            `[CONTRACT_SLOT_DEAD] ${rel(owner)} does not declare ${slot}, selected by ${rel(file)}`,
          );
      }
  }
  if (captureContract(project).reader.identity() !== captured.reader.identity())
    throw sourceError("Source contract inputs changed during evaluation");
  return {
    ok: errors.length === 0,
    errors,
    inputDigest: captured.reader.identity(),
    usage,
    slots,
    summary: {
      providerCount: providers.size,
      providerModuleCount: [...providers.values()].reduce(
        (n, m) => n + m.size,
        0,
      ),
      scannedConsumerCount: consumers.size,
      consumerCount: consumedFiles.size,
      importedBindings: usage.reduce((n, u) => n + u.bindings.length, 0),
      selectedSlots: new Set(slots.map((s) => s.slot)).size,
    },
  };
}
