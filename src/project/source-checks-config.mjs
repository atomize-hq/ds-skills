import { exact, fail, resolveProjectPath } from "./config.mjs";
const id = (v) => typeof v === "string" && /^[a-z][a-z0-9-]*$/.test(v);
export function readSourceChecks(value, root) {
  if (value == null) return null;
  exact(value, ["policy", "contract"], "sourceChecks");
  for (const k of ["policy", "contract"])
    if (!Object.hasOwn(value, k))
      fail(`sourceChecks.${k} must be configured or null`);
  return {
    policy: readPolicy(value.policy, root),
    contract: readContract(value.contract, root),
  };
}
function readPolicy(v, root) {
  if (v === null) return null;
  exact(
    v,
    ["file", "extensions", "recursive", "timeoutMs"],
    "sourceChecks.policy",
  );
  if (
    !Array.isArray(v.extensions) ||
    !v.extensions.length ||
    new Set(v.extensions).size !== v.extensions.length ||
    v.extensions.some((x) => typeof x !== "string" || !/^\.[a-z0-9]+$/.test(x))
  )
    fail("policy.extensions must be unique file extensions");
  if (typeof v.recursive !== "boolean")
    fail("policy.recursive must be boolean");
  if (
    !Number.isSafeInteger(v.timeoutMs) ||
    v.timeoutMs < 10 ||
    v.timeoutMs > 10000
  )
    fail("policy.timeoutMs must be an integer from 10 to 10000");
  return {
    ...v,
    file: resolveProjectPath(root, v.file, "sourceChecks.policy.file"),
  };
}
function readContract(v, root) {
  if (v === null) return null;
  exact(
    v,
    ["adapter", "providers", "consumers", "recursive", "slots"],
    "sourceChecks.contract",
  );
  if (v.adapter !== "ts-named-imports-slots-v1")
    fail("Unsupported source contract adapter");
  if (typeof v.recursive !== "boolean")
    fail("contract.recursive must be boolean");
  if (
    !Array.isArray(v.providers) ||
    !v.providers.length ||
    !Array.isArray(v.consumers) ||
    !v.consumers.length
  )
    fail("contract requires providers and consumer directories");
  const ids = new Set(),
    prefixes = new Set();
  const providers = v.providers.map((p) => {
    exact(p, ["id", "root", "modulePrefix", "entrypoint"], "contract.provider");
    if (!id(p.id) || ids.has(p.id))
      fail("Provider IDs must be unique lowercase identifiers");
    ids.add(p.id);
    if (
      typeof p.modulePrefix !== "string" ||
      !p.modulePrefix.length ||
      /\s|\\|\/$/.test(p.modulePrefix) ||
      prefixes.has(p.modulePrefix)
    )
      fail(
        "Provider module prefixes must be unique, without whitespace or trailing slash",
      );
    prefixes.add(p.modulePrefix);
    if (
      p.entrypoint !== null &&
      (typeof p.entrypoint !== "string" ||
        !p.entrypoint.length ||
        p.entrypoint.split("/").some((x) => !x || x === "." || x === "..") ||
        /[\\:]/.test(p.entrypoint))
    )
      fail("Provider entrypoint must be null or a normalized module key");
    return { ...p, root: resolveProjectPath(root, p.root, "provider.root") };
  });
  exact(v.slots, ["mode", "owners"], "contract.slots");
  if (!["filename-prefix", "off"].includes(v.slots.mode))
    fail("Unsupported slot ownership mode");
  exact(
    v.slots.owners,
    Object.keys(v.slots.owners ?? {}),
    "contract.slots.owners",
  );
  if (v.slots.mode === "off" && Object.keys(v.slots.owners).length)
    fail("Disabled slots cannot declare owners");
  const owners = Object.fromEntries(
    Object.entries(v.slots.owners).map(([slot, file]) => {
      if (!id(slot)) fail("Slot names must be lowercase identifiers");
      return [slot, resolveProjectPath(root, file, "slot owner")];
    }),
  );
  return {
    ...v,
    providers,
    consumers: v.consumers.map((p) =>
      resolveProjectPath(root, p, "contract.consumer"),
    ),
    slots: { mode: v.slots.mode, owners },
  };
}
