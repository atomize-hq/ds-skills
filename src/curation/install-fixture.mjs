import fs from "node:fs";
import path from "node:path";
import { projectFixture } from "../project-host/fixture.mjs";
import { setupProjectInstallation } from "../project-host/setup.mjs";
import { curationFixture, acceptFixtureCuration } from "./fixture.mjs";
import { runCuration } from "./command.mjs";
export async function curatedInstallFixture(options = {}) {
  const f = await curationFixture(options),
    release = projectFixture();
  fs.copyFileSync(
    release.recordPath,
    path.join(f.root, "ds-skills.release.json"),
  );
  await setupProjectInstallation({ root: f.root, prefix: release.prefix });
  await runCuration(f.project(), "build");
  acceptFixtureCuration(
    f,
    fs.readFileSync(path.join(f.root, f.config.curation.candidate), "utf8"),
  );
  return {
    ...f,
    release,
    receipt: path.join(f.root, ".ds-skills/curation.json"),
  };
}
