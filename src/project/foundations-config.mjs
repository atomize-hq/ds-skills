import { exact, resolveProjectPath } from "./config.mjs";
export function readFoundations(value, root) {
  if (value == null) return null;
  const keys = ["artifact", "model", "presentation", "output", "lockPath"];
  exact(value, keys, "foundations");
  return Object.fromEntries(
    keys.map((k) => [
      k,
      resolveProjectPath(root, value[k], `foundations.${k}`),
    ]),
  );
}
