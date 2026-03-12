# SLA

Service level objectives for `workspace-dev` release and package integrity operations.

## SLO Targets

| Area | Target | Measurement Window |
| --- | --- | --- |
| Release pipeline success rate | >= 99.0% successful runs | 30 days |
| Security fix release lead time (high severity) | <= 24 hours | Per incident |
| Time to deprecate affected version after confirmed issue | <= 2 hours | Per incident |

## Incident Classes

| Class | Definition | Initial Response |
| --- | --- | --- |
| P1 | Supply-chain compromise or critical publish integrity failure | 15 minutes |
| P2 | Release blocking defect without compromise | 30 minutes |
| P3 | Non-blocking release regression | 4 hours |
| P4 | Documentation/process gap | 1 business day |

## Escalation Matrix

| Trigger | Escalate To | Maximum Delay |
| --- | --- | --- |
| P1 incident detected | Security + Release Engineering lead | 15 minutes |
| P2 unresolved | Platform Engineering lead | 60 minutes |
| Repeated gate failure (>3 attempts) | Architecture owner | 1 business day |

