import path from "node:path";
import { sourceReader, sourceError } from "./inputs.mjs";
import { parseContractSource } from "../storybook/csf-parser.mjs";
export function captureContract(project) {
  const config = project.sourceChecks?.contract;
  if (!config) throw sourceError("Source contract checking is not configured");
  const reader = sourceReader(project.rootDir);
  reader.read(project.configPath);
  const parsed = new Map(),
    providers = new Map(),
    consumers = new Set();
  function parse(file) {
    if (parsed.has(file)) return;
    const result = parseContractSource(reader.read(file), file);
    if (result.errors.length)
      throw sourceError(
        `Unsupported or invalid TS/TSX source ${path.relative(project.rootDir, file)}: ${result.errors.join("; ")}`,
      );
    parsed.set(file, result);
  }
  for (const provider of config.providers) {
    const modules = new Map();
    for (const file of reader.list(
      provider.root,
      [".ts", ".tsx"],
      config.recursive,
    )) {
      const key = path
        .relative(provider.root, file)
        .split(path.sep)
        .join("/")
        .replace(/(?:\.d)?\.tsx?$/, "");
      if (modules.has(key))
        throw sourceError(`Ambiguous provider module ${provider.id}/${key}`);
      modules.set(key, file);
      parse(file);
    }
    providers.set(provider.id, modules);
  }
  for (const root of config.consumers)
    for (const file of reader.list(root, [".ts", ".tsx"], config.recursive)) {
      consumers.add(file);
      parse(file);
    }
  return { reader, parsed, providers, consumers };
}
export function matchProvider(specifier, providers) {
  return [...providers]
    .sort((a, b) => b.modulePrefix.length - a.modulePrefix.length)
    .find(
      (p) =>
        specifier === p.modulePrefix ||
        specifier.startsWith(`${p.modulePrefix}/`),
    );
}
