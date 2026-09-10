import http from "node:http";
import crypto from "node:crypto";
import { zip, entry } from "../release/archive.mjs";
import { exampleSha } from "../../src/chromatic/fixture.mjs";
export async function statusHttpFixture(f) {
  const state = {
    status: globalThis.structuredClone(f.status),
    requests: [],
    run: {
      id: 123,
      repository: { id: 9, full_name: "example/ui" },
      head_repository: { id: 9, full_name: "example/ui" },
      path: ".github/workflows/review.yml",
      status: "completed",
      head_sha: exampleSha,
    },
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    state.requests.push({
      path: url.pathname,
      authorization: request.headers.authorization,
    });
    if (state.httpError) {
      response.writeHead(state.httpError).end();
      return;
    }
    const archive =
      state.archive ??
      zip([entry("status.json", Buffer.from(JSON.stringify(state.status)))]);
    const artifact = {
      id: 77,
      name: `review-${exampleSha}`,
      expired: false,
      created_at: new Date().toISOString(),
      digest: `sha256:${crypto.createHash("sha256").update(archive).digest("hex")}`,
      workflow_run: {
        id: 123,
        repository_id: 9,
        head_repository_id: 9,
        head_sha: exampleSha,
      },
      ...state.artifact,
    };
    const send = (value) =>
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(value));
    if (url.pathname.endsWith("/actions/artifacts")) {
      send(state.listing ?? { total_count: 1, artifacts: [artifact] });
      return;
    }
    if (url.pathname.includes("/actions/runs/")) {
      send(state.run);
      return;
    }
    if (url.pathname.endsWith("/zip")) {
      response
        .writeHead(302, {
          location: state.redirect ?? `${state.base}/download`,
        })
        .end();
      return;
    }
    if (url.pathname === "/download") {
      state.duringDownload?.();
      response.writeHead(200).end(archive);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  f.config.storybook.chromatic.restore = {
    apiBase: state.base,
    repository: "example/ui",
    workflow: "review.yml",
    artifactPrefix: "review-",
    entry: "status.json",
    tokenEnv: "DS_TEST_GH_TOKEN",
    maxPages: 3,
  };
  f.write("project.json", f.config);
  return {
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
