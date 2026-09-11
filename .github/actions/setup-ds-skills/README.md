# Set up pinned ds-skills

The action source shipped with public `v0.5.3` is package-tested against an isolated staged
release. Use an immutable reviewed full commit, not a moving branch, as production setup
authority. This source's `0.5.4` package version is a release candidate until a matching tag and
assets are published; do not claim GitHub runner proof from local package tests. Pin the action to a reviewed product commit, separately from the reviewed
`ds-skills.release.json` in the project. The action revision provides acquisition
and verification code; the project pin chooses the immutable runtime and skills.

The caller must check out the consumer and provide Node 22+ and Bash. No product
build, npm install, consumer package dependencies, Figma credential or GitHub token
is needed by this action. It runs the product's source-only provisioning API,
verifies bootstrap bytes before execution, then invokes and checks the selected
installed product's ownership-safe project setup. It does not implement a separate
resolver, skill linker or installer in the consumer workflow.

After checkout and Node provisioning, the consumer's invocation is:

```yaml
- uses: atomize-hq/ds-skills/.github/actions/setup-ds-skills@<reviewed-full-commit>
  id: ds
  with:
    project-directory: .
    # Optional: install-prefix and release-mirror.
- run: node "$DS_SKILLS_LAUNCHER" --check
  env:
    DS_SKILLS_LAUNCHER: ${{ steps.ds.outputs.launcher }}
    DS_SKILLS_PREFIX: ${{ steps.ds.outputs.prefix }}
```

Relative project/prefix inputs resolve from `GITHUB_WORKSPACE`, not the action's
own checkout or the shell's cwd. The default prefix is `RUNNER_TEMP/ds-skills`.
Use the returned prefix for subsequent invocations. Inputs travel through
environment variables and are not interpolated into executable shell source.
Outputs (`release`, `prefix`, `launcher`) are written only after successful setup
and post-command deterministic checks of all expected installed output files.

This is an explicit acquisition step and may access the selected release/mirror.
Later ordinary project commands never install implicitly. Edited or unowned files
make setup fail without forcing replacement; no successful action outputs are
emitted for failure. Existing legacy discovery links require reviewed migration,
not a force-delete option.

Pins and action source are executable trust decisions: run untrusted PR code/pins
only in appropriately isolated, unprivileged jobs. Do not combine unreviewed pin
changes with privileged `pull_request_target`, secrets, production Figma state or
an unrestricted self-hosted runner. Bootstrap digest verification cannot make an
attacker-chosen pin trustworthy. Use the project's normal review/protection policy.

Metadata/input/output conventions follow the
[GitHub composite-action guide](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action).
Local packaged tests exercise the exact declared shell command from a copied
action/source tree without build output or dependencies. The product workflow
also invokes this local composite action against an isolated staged release;
actual GitHub runner proof requires that workflow to pass after push.
