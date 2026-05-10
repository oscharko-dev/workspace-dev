# Human-review fixtures (Issue #2179)

Reference shapes for the human-oversight queue + decision-capture
surface. The signature/key fields in `human-review-log.example.json`
are zero-filled placeholders — they are illustrative, not verifiable.
Real verdicts must carry an ed25519 detached signature over the
canonical-JSON serialisation of the verdict body (every field except
`signatureHex`); see `src/test-intelligence/human-review-queue.ts`.

## Files

- `queue-item.example.json` — one `HumanReviewQueueItem` as it would
  be enqueued by the harness when judges disagree above the
  cross-family threshold.
- `human-review-log.example.json` — one per-run `HumanReviewLog` as it
  would be bundled into the W6-1 audit-dossier.

## Regenerating

The queue + verdict + log shapes are governed by
`src/contracts/index.ts`. To regenerate a real (signed) verdict:

```bash
workspace-dev test-intelligence review decide <item-id> \
  --tenant <tenant> \
  --verdict approved \
  --rationale rationale.md \
  --sign-key reviewer.pem \
  --decided-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

See [docs/test-intelligence/human-oversight.md](../../../docs/test-intelligence/human-oversight.md).
