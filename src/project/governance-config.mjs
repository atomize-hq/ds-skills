import { exact, fail, resolveProjectPath } from "./config.mjs";

export function readGovernance(value, root, tokens, build) {
  if (value == null) return null;
  exact(value, ["publication"], "tokens.governance");
  if (!build) fail("tokens.governance requires tokens.build");
  for (const key of ["runtimeChecks", "manualEditGuard"])
    if (!Object.hasOwn(tokens, key))
      fail(
        `Governance requires explicit tokens.${key} selection (object or null)`,
      );
  if (!Object.hasOwn(value, "publication"))
    fail("governance.publication must be configured or null");
  if (value.publication === null) return { publication: null };
  const keys = ["config", "baseline", "ledger", "profile", "proof"];
  exact(value.publication, keys, "governance.publication");
  const publication = Object.fromEntries(
    keys.map((key) => [
      key,
      resolveProjectPath(
        root,
        value.publication[key],
        `governance.publication.${key}`,
      ),
    ]),
  );
  return { publication };
}
export function publicationInputs(project) {
  const publication = project.tokens?.governance?.publication;
  return publication ? Object.values(publication) : [];
}
