# Installed Chromatic publication

`chromatic review publish --config <project.json> --branch <review-branch>` uploads
an existing Storybook build to the configured Chromatic project. It is an explicit
remote mutation and can consume the project's snapshot allowance. Normal status
validation never calls it. No shared publication is attempted without the selected
project credential; missing credentials return inability-to-evaluate (2), not success.

## Configuration and authority

Add optional `publish` to `storybook.chromatic`:

```json
{
  "publish": {
    "provider": "chromatic-node-v15",
    "buildDir": "storybook-static",
    "tokenEnv": "CHROMATIC_PROJECT_TOKEN",
    "repository": "example/design-system",
    "timeoutSeconds": 1200,
    "mode": "review"
  }
}
```

The product release bundles **chromatic 15.3.0**, matching the extracted integration's
provider version. The release does not borrow a consumer package, run `npx`, or acquire
a newer provider at invocation time. Its upstream package license and retained bundle
notices ship alongside the adapter. The upstream bundle is not an independently
reconstructed transitive SBOM.

`--branch` is explicit review routing. The revision is always the configured project's
actual Git HEAD, not an ambient GitHub SHA or caller override. All proof/configuration
inputs must be tracked and match the exact committed Git blob bytes (not index flags).
Use a checkout that preserves committed line endings; automatic CRLF conversion is
not silently treated as identical evidence. Unrelated working-tree edits are not
promoted into evidence. An isolated consumer proof needs its own committed config.

The prebuilt directory must contain real `index.html`, `iframe.html`, and a Storybook
index-v5 `index.json` with every current review story ID. Source/configuration,
installation and writable-output directory overlaps and non-regular files are refused.
The file tree is bounded (20,000 files, 512 MiB total, 100 MiB per file), hashed before
execution and checked afterward. This verifies stable uploaded input and current index
coverage; it does **not** prove that an externally built JavaScript bundle corresponds
to current source merely because story IDs match. CI must build from that exact
checkout and bind downloaded build artifacts to that revision/run. Review everything
in the selected build directory: all its assets are eligible for upload, and this
adapter is not a secret scanner or untrusted-project sandbox.

## Provider execution and result handling

- A separate installed Node worker runs in the configured project root. It receives
  a narrowly selected environment and explicit `CHROMATIC_SHA`, `CHROMATIC_BRANCH`,
  and `CHROMATIC_SLUG`; inherited provider/Git/GitHub/Node options and unrelated secrets
  are excluded. The project token travels over IPC, not command-line arguments.
- Prebuilt mode, a fresh empty configuration file, noninteractive mode, disabled
  auto-accept, disabled early-upload exit, disabled only-changed filtering and disabled
  update checks prevent ambient configuration from silently narrowing the review.
- `mode: "deferred"` explicitly requests the provider's skip path. A failed provider
  exit still yields failed evidence, never a successful deferral. Deferral does not
  establish passed visual tests or release readiness.
- A bounded provider result plus this invocation's isolated diagnostics supplies the
  build URL. No previous diagnostic file is reused. Missing exit codes, invalid counts,
  missing completed-review change counts, invalid URLs and provider transport failures
  cannot become a passing status. Returned component/interaction errors remain failures.
- The worker's stdout/stderr are bounded and never forwarded raw, since upstream
  diagnostics can include credentials. Diagnostics/log/config scratch files are private
  and removed on normal completion/failure. A timeout kills the worker and returns 2;
  it cannot roll back a remote build already started. Abrupt host termination can leave
  private temporary files; this is not transactional remote publication.
- Source/config/HEAD, prebuilt content and previous output are rechecked before the
  shared locked atomic status write. Inability-to-evaluate and concurrent edits preserve
  prior bytes. Actual valid failed-review evidence is persisted with exit 1.

Exit 0 means publication produced conformant passed, changed or deliberately deferred
review evidence. It is not release-claim approval. Exit 1 means an evaluated failure;
2 means inability to evaluate and emits no JSON result. `--json` results use version 1,
command `chromatic review publish`, scope `remote-visual-review`, and include the build
digest, provider version/code, review outcome and artifact disposition.

**CI must not upload a prior status file after a failed publication attempt merely
because that file still exists.** Upload only when this command's current result says
`artifactStatus` is `written` or `unchanged`; propagate command failure independently.
A failed review with a newly written artifact is useful evidence, but never approval.
An empty result on exit 2 must not be replaced with success or an older receipt.

## Verification boundary

Unit tests exercise result normalization, failure/deferral separation, alternate
component libraries, immutable source/build checks, private scratch cleanup, options,
credential refusal, transport bounds and timeout/error handling. Installed-release
probes load the actual bundled provider without consumer dependencies and exercise
publication refusal without credentials. Injected test executors are not a production
config option and are not live Chromatic proof.

Actual remote publication and consumer CI artifact/revision integration remain required
before cutover/landing. GitHub PR merge SHA versus source-head identity must be handled
explicitly; see [status restoration](README.md). Figma publication is separate and is
not verified by this command.

Provider references: [Chromatic CLI](https://www.chromatic.com/docs/cli/) and its pinned
`chromatic@15.3.0` published Node API declarations/bundle. The live CLI docs can describe
newer versions; the pinned adapter contract and its tests govern this release.
