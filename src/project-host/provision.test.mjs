import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { projectFixture } from "./fixture.mjs";
import { provisionProject } from "./provision.mjs";
import { setupProjectInstallation } from "./setup.mjs";
import { acquireRelease } from "../install/acquire.mjs";
vi.mock("../install/acquire.mjs", () => ({ acquireRelease: vi.fn() }));
const fixtures = [];
function fixture() {
  const f = projectFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  vi.resetAllMocks();
  for (const f of fixtures.splice(0))
    fs.rmSync(f.root, { recursive: true, force: true });
});
it("shares explicit provisioning without acquiring an already intact release", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  const result = await provisionProject({ ...f.options, capture: true });
  expect(result).toMatchObject({
    status: 0,
    root: fs.realpathSync(f.project),
    release: f.record.release,
    prefix: f.prefix,
    home: f.home,
  });
  expect(acquireRelease).not.toHaveBeenCalled();
});
it("does not trust setup exit zero without verified project outputs", async () => {
  const f = fixture();
  await expect(
    provisionProject({ ...f.options, capture: true }),
  ).rejects.toThrow("without establishing the complete project installation");
  expect(fs.existsSync(f.receipt)).toBe(false);
});
it("rejects pin changes across acquisition before target execution", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.home, "lib/dist/module.js"), "changed");
  vi.mocked(acquireRelease).mockImplementation(() => {
    fs.appendFileSync(f.pin, "\n");
  });
  await expect(
    provisionProject({ ...f.options, capture: true }),
  ).rejects.toThrow("pin changed");
  expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
});
it("re-verifies a supposedly successful acquisition rather than executing a corrupt target", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.home, "lib/dist/module.js"), "changed");
  vi.mocked(acquireRelease).mockResolvedValue({});
  await expect(
    provisionProject({ ...f.options, capture: true }),
  ).rejects.toThrow("failed verification");
  expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
});
it("rejects a symbolic pin before reaching acquisition", async () => {
  const f = fixture();
  fs.unlinkSync(f.pin);
  fs.symlinkSync(f.recordPath, f.pin);
  await expect(
    provisionProject({ ...f.options, capture: true }),
  ).rejects.toThrow("regular file");
  expect(acquireRelease).not.toHaveBeenCalled();
});
