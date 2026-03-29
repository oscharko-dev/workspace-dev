# Audit Events

`workspace-dev` emits operational logs as text or newline-delimited JSON. When `logFormat=json`, audit-relevant request logs use the same JSONL stream as the existing runtime logger.

## Base JSON Fields

Every JSON log line keeps the existing base schema:

- `ts`: ISO-8601 timestamp
- `level`: `debug | info | warn | error`
- `msg`: sanitized log message

Audit-relevant records may also include:

- `requestId`: request correlation identifier echoed via `X-Request-Id`
- `event`: stable audit event name
- `method`: HTTP method
- `path`: HTTP route path
- `statusCode`: HTTP response status
- `jobId`: linked workspace job identifier when the request creates or targets a job
- `stage`: existing pipeline stage field for job-engine logs

## Request Correlation

- Every HTTP response includes `X-Request-Id`.
- If the incoming request already provides a non-empty `X-Request-Id`, `workspace-dev` reuses it, provided it passes validation: maximum 128 characters, containing only word characters (`a-z`, `A-Z`, `0-9`, `_`), dots, colons, hyphens, and forward slashes.
- If the client-provided ID is missing, empty, oversized, or contains disallowed characters, `workspace-dev` generates a UUID v4 request ID instead.
- JSON error envelopes include `requestId` so clients can correlate failed requests with runtime logs.

## Covered Audit Events

Security and write-route operations use the following event names:

- `security.request.rejected_origin`
- `security.request.unsupported_media_type`
- `security.request.rate_limited`
- `workspace.request.validation_failed`
- `workspace.request.failed`
- `workspace.submit.accepted`
- `workspace.cancel.accepted`
- `workspace.sync.previewed`
- `workspace.sync.applied`
- `workspace.regenerate.accepted`
- `workspace.create_pr.completed`
- `workspace.stale_check.completed`
- `workspace.remap_suggest.completed`

## Event Notes

- `workspace.submit.accepted` and `workspace.regenerate.accepted` include both `requestId` and the accepted `jobId` for request-to-job correlation.
- `workspace.request.validation_failed` is used for malformed JSON, schema validation failures, and other rejected write-route inputs.
- `workspace.request.failed` is used when a write route fails after passing request validation or when the request handler returns an unexpected internal failure.
- Informational GET routes still receive `X-Request-Id`, but dedicated audit events are limited to the covered security/write operations and unexpected handler failures.

## Non-Goals

- This issue does not add external SIEM transport, log shipping, or a separate audit-log subsystem.
- This issue does not redesign the broader runtime logger API beyond the additive request/audit fields above.
