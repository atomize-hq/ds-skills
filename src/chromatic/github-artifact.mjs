import { statusError } from "./status.mjs";
export async function findStatusArtifact(client, config, gitSha) {
  const name = `${config.artifactPrefix}${gitSha}`,
    found = [];
  let complete = false,
    total = null;
  const seen = new Set();
  for (let page = 1; page <= config.maxPages; page++) {
    const response = await client.json(
      `/repos/${config.repository}/actions/artifacts?per_page=100&page=${page}&name=${encodeURIComponent(name)}`,
    );
    if (
      !Array.isArray(response?.artifacts) ||
      !Number.isSafeInteger(response.total_count) ||
      response.total_count < 0
    )
      throw statusError("Invalid GitHub artifact listing");
    if (
      response.artifacts.length !==
        Math.min(100, Math.max(0, response.total_count - (page - 1) * 100)) ||
      (total !== null && total !== response.total_count)
    )
      throw statusError("Inconsistent artifact pagination snapshot");
    total = response.total_count;
    for (const item of response.artifacts) {
      if (seen.has(item?.id))
        throw statusError("Duplicate artifact identity across pages");
      seen.add(item?.id);
    }
    for (const artifact of response.artifacts)
      if (artifact?.name === name && artifact.expired === false) {
        if (
          !Number.isSafeInteger(artifact.id) ||
          artifact.id < 1 ||
          !Number.isSafeInteger(artifact.workflow_run?.id) ||
          artifact.workflow_run.id < 1
        )
          throw statusError(
            "Artifact has invalid identity or workflow binding",
          );
        if (
          typeof artifact.created_at !== "string" ||
          !Number.isFinite(Date.parse(artifact.created_at))
        )
          throw statusError("Artifact creation time is invalid");
        found.push(artifact);
      }
    if (page * 100 >= response.total_count) {
      complete = true;
      break;
    }
    if (response.artifacts.length === 0)
      throw statusError("Incomplete GitHub artifact pagination");
  }
  if (!complete)
    throw statusError(
      "Artifact pagination limit reached; no incomplete selection is trusted",
    );
  const qualified = [];
  for (const artifact of found) {
    const run = await client.json(
      `/repos/${config.repository}/actions/runs/${artifact.workflow_run.id}`,
    );
    if (
      run?.id !== artifact.workflow_run.id ||
      typeof run.repository?.full_name !== "string" ||
      run.repository?.full_name?.toLowerCase() !==
        config.repository.toLowerCase()
    )
      throw statusError("Workflow run identity/repository mismatch");
    if (
      typeof run.path !== "string" ||
      typeof run.status !== "string" ||
      typeof run.head_sha !== "string" ||
      typeof run.head_repository?.full_name !== "string"
    )
      throw statusError("Malformed workflow run metadata");
    if (
      run.path !== `.github/workflows/${config.workflow}` ||
      run.status !== "completed" ||
      run.head_sha !== gitSha ||
      run.head_repository?.full_name?.toLowerCase() !==
        config.repository.toLowerCase()
    )
      continue;
    if (
      ![
        run.repository.id,
        run.head_repository.id,
        artifact.workflow_run.repository_id,
        artifact.workflow_run.head_repository_id,
      ].every((id) => Number.isSafeInteger(id) && id > 0)
    )
      throw statusError("Workflow repository identities are invalid");
    if (
      run.head_repository.id !== run.repository.id ||
      artifact.workflow_run.head_sha !== run.head_sha ||
      artifact.workflow_run.repository_id !== run.repository.id ||
      artifact.workflow_run.head_repository_id !== run.head_repository.id
    )
      throw statusError("Artifact workflow metadata is inconsistent");
    qualified.push(artifact);
  }
  if (!qualified.length) return null;
  qualified.sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  );
  return qualified[0];
}
