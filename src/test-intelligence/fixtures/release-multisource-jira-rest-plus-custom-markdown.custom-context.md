# Non-Functional Test Context

| Attribute  | Value                                       |
| ---------- | ------------------------------------------- |
| Latency    | under 200 milliseconds at peak load         |
| Throughput | at least 500 requests per second per tenant |

## Test Tasks

- [ ] Test under peak load
- [ ] Test under burst load
- [ ] Test that 429 responses include a Retry-After header

## Risk Hints

PSD2 compliance required.
