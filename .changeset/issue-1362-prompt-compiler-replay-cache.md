---
"workspace-dev": minor
---

Add prompt compiler, generated test case JSON schema, and replay cache for Issue #1362.

- Export `compilePrompt`, `buildGeneratedTestCaseListJsonSchema`, `validateGeneratedTestCaseList`, `createMemoryReplayCache`, and `createFileSystemReplayCache` from `src/test-intelligence/`.
- Add `GeneratedTestCase`, `GeneratedTestCaseList`, `CompiledPromptRequest`, `CompiledPromptArtifacts`, `ReplayCacheKey`, and `ReplayCacheEntry` to the public contract surface (contracts 3.20.0).
- Add `VISUAL_SIDECAR_SCHEMA_VERSION` and `REDACTION_POLICY_VERSION` constants and bind them into the cache key so a sidecar/policy bump always forces a cache miss.
- Replay cache hits skip the LLM gateway entirely; misses produce a `CompiledPromptRequest` ready for the gateway client.
- Compiled artifacts persist only redacted material — golden test asserts no original PII can leak through prompt compilation.
