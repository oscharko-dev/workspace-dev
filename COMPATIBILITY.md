# Compatibility Matrix

## Runtime and Platform Matrix

| Capability | Minimum | Supported |
| --- | --- | --- |
| Node.js runtime | 22.0.0 | 22.x, 24.x |
| Module systems | Dual | ESM `import`, CJS `require` |
| OS support | POSIX + Windows | Linux, macOS, Windows |
| Air-gap installation | Required | Supported (offline tarball install) |
| FIPS smoke lane | Optional host capability | Verified in CI, skipped when OpenSSL FIPS module is unavailable |

## Contract and Mode Matrix

| Area | workspace-dev |
| --- | --- |
| Contract version | `2.26.0` |
| `figmaSourceMode=rest` | Supported |
| `figmaSourceMode=local_json` | Supported |
| `figmaSourceMode=mcp` | Blocked |
| `figmaSourceMode=hybrid` | Supported |
| `llmCodegenMode=deterministic` | Supported |
| `llmCodegenMode=hybrid` | Blocked |
| `llmCodegenMode=llm_strict` | Blocked |

## Notes

- Public compatibility policy for contract changes is documented in `CONTRACT_CHANGELOG.md`.
- Versioned runtime changelog is tracked in `CHANGELOG.md`.
