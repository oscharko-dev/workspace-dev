# SUPPORT

Support policy for `workspace-dev` package consumers and release operators.

## Scope

This policy covers:

- package usage and integration support
- release pipeline incidents
- security issue escalation and coordination

## Support Channels

- General support: GitHub issues in the `oscharko-dev/workspace-dev` repository
- Release operations support: maintainers listed in repository ownership controls
- Security escalation: [security@oscharko.dev](mailto:security@oscharko.dev)

Do not report vulnerabilities in public issues. Use the security mailbox for private intake.

## Response Targets

| Request Type | Initial Response Target | Resolution Target |
| --- | --- | --- |
| P1 security or supply-chain incident | 15 minutes | Continuous response until mitigation |
| P2 release blocking defect | 30 minutes | Same business day |
| P3 non-blocking regression | 4 hours | 2 business days |
| P4 documentation/process request | 1 business day | 5 business days |

SLA references and release resiliency obligations are defined in `SLA.md`, `ESCROW.md`, and `COMPLIANCE.md`.

## Escalation Path

1. Open support request through the appropriate channel.
2. If release blocking or security relevant, escalate immediately to maintainers.
3. For vulnerabilities, coordinate private triage via `security@oscharko.dev`.
4. If affected versions are confirmed, deprecate impacted versions and ship a forward-fix release.
