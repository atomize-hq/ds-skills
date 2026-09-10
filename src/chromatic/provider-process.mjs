import { fork } from "node:child_process";
import { statusError } from "./status.mjs";
export function providerEnvironment(env, { gitSha, branchName, repository }) {
  const allowed =
    /^(PATH|HOME|USERPROFILE|SYSTEMROOT|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|https_proxy|http_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/;
  return {
    ...Object.fromEntries(Object.entries(env).filter(([k]) => allowed.test(k))),
    CI: "true",
    CHROMATIC_SHA: gitSha,
    CHROMATIC_BRANCH: branchName,
    CHROMATIC_SLUG: repository,
  };
}
export async function executeChromaticProvider(
  input,
  { worker = new URL("./provider-worker.mjs", import.meta.url) } = {},
) {
  return new Promise((resolve, reject) => {
    const child = fork(worker, [], {
      cwd: input.rootDir,
      env: providerEnvironment(input.env, input),
      execArgv: [],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let result = null,
      problem = null,
      bytes = 0;
    const fail = (message) => {
      problem ??= message;
      child.kill("SIGKILL");
    };
    const timer = globalThis.setTimeout(
      () => fail("Chromatic provider timed out; remote build may still exist"),
      input.timeoutSeconds * 1000,
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024)
          fail("Chromatic provider output exceeded its limit");
      });
    child.on("message", (message) => {
      if (
        result ||
        message?.kind !== "result" ||
        JSON.stringify(message).length > 16384
      )
        fail("Chromatic provider did not return a usable bounded result");
      else result = message.result;
    });
    child.on("error", () => {
      problem = "Cannot execute the installed Chromatic provider";
    });
    child.on("close", (code) => {
      globalThis.clearTimeout(timer);
      if (problem || code !== 0 || !result)
        reject(
          statusError(
            problem ?? "Chromatic provider failed without usable evidence",
          ),
        );
      else resolve(result);
    });
    child.send({ options: input.options }, (error) => {
      if (error) fail("Cannot initialize Chromatic provider");
    });
  });
}
