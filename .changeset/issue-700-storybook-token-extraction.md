---
"workspace-dev": patch
---

Harden Storybook token extraction for Issue #700.

- Promote `storybook.tokens` and `storybook.themes` extension metadata to version `3`.
- Add sanitized provenance metadata grouped by token class and theme context.
- Merge authoritative Storybook theme bundle evidence across compatible sources and allow Storybook args/argTypes backfill only for missing token classes.
- Fail `ir.derive` with `E_STORYBOOK_TOKEN_EXTRACTION_INVALID` when Storybook token extraction has fatal completeness or consistency diagnostics.
