# Product-owned release resolution and acquisition

Version 0.5.0 uses this version-2 contract. Historical v0.4.0 pins do not carry
its sealed manifest and cannot satisfy it; migrating a consumer requires a new
reviewed release pin, not an integrity bypass. The [project installation contract](../project-host/README.md)
provides the pinned launcher and ownership-safe Codex/Claude skill discovery.

```sh
ds-skills release verify --record ds-skills.release.json --prefix /path/to/prefix --json
ds-skills release install --record ds-skills.release.json --prefix /path/to/prefix --json
```

Use a trusted product executable for these commands. `release install` may fetch
only the explicitly pinned release; it does not discover latest versions or choose
an executable from PATH. It does nothing when the selected installation verifies,
repairs a damaged installation from verified bytes, and supports explicit `--force`
reinstallation. Versions coexist under `<prefix>/<release>`. Project data and
custom skill outputs do not belong inside this immutable product directory.

`--prefix` overrides `DS_SKILLS_PREFIX`; otherwise Unix uses
`~/.local/share/ds-skills` and Windows uses `%LOCALAPPDATA%/ds-skills`. Optional
`--mirror` (or `DS_SKILLS_BASE_URL`) changes transport only. Mirrors must be HTTP(S)
base URLs without embedded credentials, query or fragment. Bootstrap downloads
are unauthenticated, with a 60-second timeout. Mirror selection also reaches the
verified bootstrap, which still enforces its baked payload digests.

## Trust and identity

The reviewed record supplies `recordVersion: "2"`, repository, release, full source
commit, bootstrap/checksum/platform asset digests, and a `payloadManifest` digest.
The fixed tested platform mappings include Linux arm64 → `linux_aarch64`; Windows
arm64 is not silently mapped to x86_64 or claimed as tested emulation.

Staging emits `payload-manifest.json` both for review and inside the payload. It
lists every installed file's SHA-256 and executable requirement, together with
release/source identity. The manifest's digest is sealed into the reviewed record.
The record is the trust anchor, not a manifest that can be edited beside the code.

`resolveRelease` reads and checks files **without executing the target**:

- Pin shape, path-safe identity, supported platform and version-specific location.
- Manifest digest and identity, safe file paths and required entry points.
- Every file's content; absent, additional, symlinked, wrong-kind or unreadable
  payload entries are rejected. POSIX launchers must have executable mode.
- Sealed CLI and skill release identities must agree with the reviewed pin.

Editing both installed code and its local manifest does not satisfy the reviewed
manifest digest. A matching version string is never sufficient. This is a local
integrity check, not a sandbox against a hostile OS or concurrent adversary who
can rewrite trusted pins/verifiers after verification. A project launcher must
verify the selected target before invoking it; executing an untrusted target to
ask it whether it is trustworthy would reverse the trust chain.

`acquireRelease` checks the bootstrap digest before creating an executable temporary
file, then waits for execution and removes only its private temporary directory.
The bootstrap verifies archive bytes before unpacking. The command verifies the
resulting installed tree again; a successful bootstrap exit alone is insufficient.
It does not replace project-specific generated skills or user-owned components.

## Results and release build

Both commands support versioned JSON results. Healthy verification/install exits
0; an existing but nonconformant installation exits 1. Missing installation on
`verify`, malformed/legacy pins, unsupported platforms and failed acquisition are
cannot-evaluate (2, no stdout result). Unexpected failures use 3, no stdout result.
Explicit `install` handles an absent installation by acquiring it. It may replace
a damaged immutable release directory; unrelated release directories are preserved.

Release staging source is tracked under `scripts/release/`; only the root generated
`/release/` directory is ignored. Staging refuses source overlap, symbolic output
paths and non-generated data in an existing output directory. It does not recursively
remove arbitrary caller-selected directories. Declared missing/symbolic release
inputs fail rather than silently disappearing from the package.

A product build first cleans its exact generated `dist` directory so removed code
or formerly compiled tests cannot leak into the next release. Both TS and MJS tests
are excluded from emitted build output, not from test execution. The check gate
builds before tests because plugin tests require the freshly prebuilt bundle.

These APIs and commands are replacements for reusable consumer provisioning code,
not a second final implementation. Consumer launcher/install/discovery cutover,
independent review and final release/pin updates remain mandatory.
