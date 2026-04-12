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
| Contract version | `3.11.0` |
| `figmaSourceMode=rest` | Supported |
| `figmaSourceMode=local_json` | Supported |
| `figmaSourceMode=figma_paste` | Supported |
| `figmaSourceMode=mcp` | Blocked |
| `figmaSourceMode=hybrid` | Supported |
| `llmCodegenMode=deterministic` | Supported |
| `llmCodegenMode=hybrid` | Blocked |
| `llmCodegenMode=llm_strict` | Blocked |

## Notes

- TypeScript 4.x consumers are unsupported and must upgrade to TypeScript `>=5.0.0`; `workspace-dev` does not publish `typesVersions` fallback paths.
- Public compatibility policy for contract changes is documented in `CONTRACT_CHANGELOG.md`.
- Package-version pinning guidance and the relationship between package version and `CONTRACT_VERSION` are documented in `VERSIONING.md`.
- Versioned runtime changelog is tracked in `CHANGELOG.md`.
