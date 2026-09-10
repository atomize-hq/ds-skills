# Chromatic status evidence

`chromatic status validate` and `chromatic status restore` are product-owned commands.
They validate/restore a review artifact; they do **not** publish a Chromatic build,
rerun visual tests, approve a release claim, or establish Figma publication.

Both accept `--config <project.json> [--root <dir>] [--sha <full-lowercase-sha>] [--json]`.
Without `--sha`, the revision is resolved from the declared project Git HEAD, with
ambient `GIT_*` overrides removed. Validation is local and read-only. Restore makes
explicit GitHub API reads and can replace the configured status file after validation.

## Configuration

Add `chromatic` alongside the existing `storybook` policy/proof configuration:

```json
{
  "chromatic": {
    "status": "artifacts/review/status.json",
    "lockPath": ".ds-artifacts/locks/review-status.lock",
    "checkName": "component-review",
    "requiredForClaim": false,
    "maxAgeMinutes": 1440,
    "maxFutureSkewSeconds": 60,
    "restore": {
      "apiBase": "https://api.github.com",
      "repository": "example/design-system",
      "workflow": "ci.yml",
      "artifactPrefix": "review-status-",
      "entry": "status.json",
      "tokenEnv": "GH_TOKEN",
      "maxPages": 10
    }
  }
}
```

Restore can be null/unconfigured when only local validation is needed. Both commands
require configured Storybook proof inputs so component/story selections and tier
claims are bound to current validated sources. Check names, paths, review policy and
repository identity are data, not product constants. The credential variable has no
implicit fallback. Public metadata reads can work without a token; private resources
and archive retrieval require the appropriate GitHub permission.

Never supply privileged credentials while executing an unreviewed project config or
untrusted PR code. The configured API destination and environment-variable selection
are trusted operator inputs. API base URLs require HTTPS; explicit HTTP loopback is
supported for isolated contract tests. Enterprise API bases may include `/api/v3`.

## Validation contract

Status version 1 is preserved. Validation retains strict fields, branch/revision,
review/check outcome alignment, selection uniqueness and timestamp checks, and adds:

- exact expected revision, configured inventory path/version and check owner;
- current component IDs, story IDs and component tiers, not self-matching stale scope;
- configured `requiredForClaim`, preventing a receipt from downgrading the policy;
- real UTC calendar timestamps, strict integer age limits and bounded future skew;
- HTTPS build URLs without URL credentials; a maximum 1 MiB status payload.

A conformant `failed`, `changed` or `deferred` result remains useful review evidence.
An exit 0 does **not** turn it into a passed visual review or a release approval.
Promotion policy must independently consume the review outcome and requirement mode.
Empty current proof scope cannot produce valid review evidence.

Exit 0 means evaluated conformance/restoration; 1 means evaluated nonconformance or no
qualifying artifact. Missing local inputs, invalid caller policy, network failures,
incomplete pagination, unsafe/unsupported archives and digest failures return 2 with
no machine result. Unexpected failures return 3 with no result. JSON results carry
resultVersion 1, exact command identity and scope `review-artifact-conformance`.

## Restore integrity and limits

1. Preflight configured output/lock paths against proof inputs and each other; take
   the shared owner-aware lock and snapshot configuration, source scope and prior bytes.
2. List the exact artifact name (`artifactPrefix` plus revision), paginating within
   the configured bound. Refuse incomplete/contradictory listings. Resolve producing
   runs from the configured repository and workflow filename. Require completed runs,
   same-repository heads and exact requested head SHA, with consistent numeric IDs.
3. Select the most recently created qualifying artifact (ID breaks ties). Fetch by
   artifact ID, never by a caller-supplied archive URL. Follow the signed download
   redirect without forwarding API credentials; refuse redirect chains/downgrades.
4. Verify the archive's SHA-256 against GitHub's artifact metadata digest. Refuse an
   absent digest; do not silently downgrade to trusting only a filename.
5. Read exactly one configured ZIP member **in memory**, never extract paths. Support
   ordinary stored/deflated single-volume ZIP entries with matching headers/CRC;
   reject ambiguity, encryption, symlinks, unsupported ZIP64 forms, corrupt data and
   oversized decompression. API JSON is capped at 4 MiB, archive downloads at 10 MiB,
   and the actual expanded status at 1 MiB. Requests have 30-second time limits.
6. Validate the downloaded status against current policy/scope **before** replacing
   anything. Recheck snapshots and prior output, then atomically rename a staged file.
   Unchanged bytes retain mtime; failures preserve prior bytes and clean temporary files.

The old command copied first and validated afterward; that behavior is intentionally
not retained. This is not a hostile-OS sandbox, nor a claim that GitHub metadata is an
independent cryptographic signature. The repository/workflow, credentials and approved
workflow source remain trust inputs. A failed newest artifact does not fall back to an
older passing artifact. Network/remote mutation races cannot establish eternal freshness.

**Revision integration:** restore deliberately requires requested SHA to equal the
producing run's `head_sha`. It does not pretend a PR synthetic merge SHA and source-head
SHA are interchangeable. Consumer CI cutover must align artifact naming, receipt SHA,
checkout and run identity (or add explicit verified merge-revision support) before
claiming the old PR restore workflow is fully migrated. No compatibility bypass is
provided. Live GitHub/consumer CI proof remains a landing requirement.

REST contracts: [artifacts](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28)
and [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28).
The client explicitly uses API version `2022-11-28`.

## Remaining extraction

[Provider publication](publish-README.md) is now implemented separately. Promotion/status
aggregation, consumer caller migration and live CI evidence remain. These status commands
do not stand in for that work. Keep existing consumer callers until their replacements
are verified, then remove duplicated consumer-owned implementations and reusable tests.
