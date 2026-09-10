import fs from "node:fs";
import { runProvider } from "./provider-api.mjs";
if (process.argv[2] === "--probe") {
  process.stdout.write(`${typeof runProvider}\n`);
} else {
  process.once("message", async (input) => {
    try {
      const result = await runProvider(input.options);
      let diagnostics = null;
      if (fs.existsSync(input.options.diagnosticsFile)) {
        if (fs.statSync(input.options.diagnosticsFile).size > 4 * 1024 * 1024)
          throw Error();
        diagnostics = JSON.parse(
          fs.readFileSync(input.options.diagnosticsFile, "utf8"),
        );
      }
      const url = [
        result.buildUrl,
        result.url,
        diagnostics?.build?.webUrl,
        diagnostics?.build?.url,
        diagnostics?.rebuildForBuild?.webUrl,
        diagnostics?.buildUrl,
      ].find((v) => typeof v === "string" && v.length);
      const response = {
        code: result.code,
        changeCount: result.changeCount,
        errorCount: result.errorCount,
        interactionTestFailuresCount: result.interactionTestFailuresCount,
        buildUrl: url,
      };
      if (JSON.stringify(response).length > 16384) throw Error();
      process.send({ kind: "result", result: response }, () => process.exit(0));
    } catch {
      // Provider diagnostics may contain credentials. Only a bounded public summary crosses IPC.
      process.send({ kind: "unavailable" }, () => process.exit(2));
    }
  });
}
