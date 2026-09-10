import { run } from "chromatic/node";
/** @returns {Promise<{code?: number, buildUrl?: string, url?: string, changeCount?: number, errorCount?: number, interactionTestFailuresCount?: number}>} */
export async function runProvider(options) {
  return run({ argv: [], flags: {}, options });
}
