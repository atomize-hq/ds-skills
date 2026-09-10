# Storybook decisions for the configured project

This is a worksheet, not a list of recommended package versions. Inspect the actual
manifest, lockfile, framework/bundler configuration and supported test adapters. For
an upgrade, verify current official compatibility documentation before changing the
project's explicit version/import policy.

| Decision              | Evidence to record                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Framework and bundler | Installed rendering framework, compatible Storybook adapter, build constraints and deliberate migration limits                  |
| Version/import policy | Exact declared package line, supported addon versions, allowed imports and obsolete packages being removed                      |
| Interaction runner    | The configured runner actually executing stories, supported adapters and real command/CI output                                 |
| Mocks                 | Router/providers, network and host boundaries; deterministic success, failure, cancellation and permission states               |
| Accessibility         | Automated checks actually run plus keyboard/focus and applicable assistive-technology proof; never infer compliance from source |
| Visual review         | Selected provider or review process, baseline existence, current scope/revision and unresolved outcomes                         |
| Design references     | Actual target nodes recorded in component specs and story metadata, with explicit target ownership                              |
| Publication           | Separate token artifact/proof/ledger workflow if configured; no implied per-component approval                                  |

Keep project decisions and status in consumer data, not in this shared skill.
A declared provider, configured addon or uploaded build does not establish that the
expected tests ran or a baseline was approved. Report unavailable evidence rather
than substituting a generic green status.
