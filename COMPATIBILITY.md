# Compatibility Matrix

## Runtime and Platform Matrix

<!-- prettier-ignore -->
| Capability | Minimum | Supported |
| --- | --- | --- |
| Node.js runtime | 22.0.0 | 22.x, 24.x |
| TypeScript consumer compiler | 5.0.0 | >=5.0.0 |
| Module systems | Dual | ESM `import`, CJS `require` |
| OS support | POSIX + Windows | Linux, macOS, Windows |
| Air-gap installation | Required | Supported (offline tarball install) |
| FIPS smoke lane | Optional host capability | Verified in CI, skipped when OpenSSL FIPS module is unavailable |

## Contract and Mode Matrix

<!-- prettier-ignore -->
| Area | workspace-dev |
| --- | --- |
| Contract version | `4.16.0` |
| `figmaSourceMode=rest` | Supported |
| `figmaSourceMode=local_json` | Supported |
| `figmaSourceMode=figma_paste` | Supported |
| `figmaSourceMode=figma_plugin` | Supported |
| `figmaSourceMode=mcp` | Blocked |
| `figmaSourceMode=hybrid` | Supported |
| `llmCodegenMode=deterministic` | Supported |
| `llmCodegenMode=hybrid` | Blocked |
| `llmCodegenMode=llm_strict` | Blocked |

## Multi-Source Test Intent Source Mix Matrix (Issue #1431)

The matrix below documents which combinations of multi-source kinds are
accepted by `validateMultiSourceTestIntentEnvelope`. At least one **primary**
source kind is always required; **supporting** kinds may only appear
alongside a primary source.

<!-- prettier-ignore -->
| Source mix | Validated | Notes |
| --- | --- | --- |
| Figma-only (any of `figma_local_json`, `figma_plugin`, `figma_rest`) | Accepted | Wave 1 baseline preserved bit-identically when the multi-source gate is off. |
| Jira REST only (`jira_rest`) | Accepted | Wave 4.C populates the actual REST adapter. |
| Jira paste only (`jira_paste`) | Accepted | Wave 4.D populates the paste-collision routing. |
| Figma + Jira REST (`jira_rest`) | Accepted | Reconciliation lives in Wave 4.F. |
| Figma + Jira paste (`jira_paste`) | Accepted | Reconciliation lives in Wave 4.F. |
| Jira REST (`jira_rest`) + Jira paste (`jira_paste`) | Accepted | Duplicate `canonicalIssueKey` between Jira sources is reported as `duplicate_jira_paste_collision`. |
| Any of the above + `custom_text` and/or `custom_structured` | Accepted | Custom kinds are supporting evidence. Markdown metadata only valid when `inputFormat="markdown"`. |
| Custom-only (any combination of `custom_text` / `custom_structured`) | **Refused** with `primary_source_required` | Enforced before any artifact is persisted. |

`POST /workspace/test-intelligence/sources/<jobId>/custom-context` is the
runtime ingestion surface for the supporting custom kinds. It remains behind
the parent test-intelligence gate and nested multi-source gate, persists only
PII-redacted canonical Markdown and validated structured attributes, and
requires an existing primary Figma or Jira source before writing artifacts.
Structured attributes are normalized, sorted, and PII-redacted in both the HTTP
validator and persistence layer so replay hashes do not depend on caller order.

## Jira Write Workflow Matrix (Issue #1482)

The table below documents the gate matrix for `runJiraSubtaskWrite`.
All gates are fail-closed; a violation in any gate prevents any write.

| Gate                 | Condition for pass                                                                |
| -------------------- | --------------------------------------------------------------------------------- |
| Feature gate         | `featureEnabled === true`                                                         |
| Admin gate           | `adminEnabled === true` (`WorkspaceStartOptions.testIntelligence.allowJiraWrite`) |
| Bearer token         | `bearerToken` non-empty string                                                    |
| Parent issue key     | Valid Jira issue key (`isValidJiraIssueKey`)                                      |
| Approved cases       | At least one approved test case                                                   |
| Policy clear         | No `policy_blocked` decisions                                                     |
| Schema clear         | No `schema_invalid` cases                                                         |
| Visual sidecar clear | No visual-sidecar-blocked cases                                                   |

## Notes

- TypeScript 4.x consumers are unsupported and must upgrade to TypeScript `>=5.0.0`; `workspace-dev` does not publish `typesVersions` fallback paths.
- Public compatibility policy for contract changes is documented in `CONTRACT_CHANGELOG.md`.
- Package-version pinning guidance and the relationship between package version and `CONTRACT_VERSION` are documented in `VERSIONING.md`.
- Versioned runtime changelog is tracked in `CHANGELOG.md`.
