# Subprocessor register fixtures

Pinned canonical-JSON snapshots of the typed `SubprocessorRegister`
artifact (Issue #2174). The register's source-of-truth lives in
`src/test-intelligence/subprocessor-register.ts`; the fixtures here are
exercised by `subprocessor-register.test.ts` to detect accidental
breaking changes to the canonical entry list, the canonical-JSON
serialisation, or the embedded SHA-256 Merkle root.

| Fixture                                | Purpose                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `expected-register.json`               | Canonical-JSON snapshot of the doc-time register (pinned `generatedAt = SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED`).      |

Bump rules — when a new subprocessor entry, cross-border transfer, or
schema-breaking change ships, regenerate the fixture by running the
matching test in `--update` mode (see the test file for the Node.js
flag) or by re-pinning the expected JSON manually after a deliberate
audit-trail review.
