# GOVERNANCE

Governance policy for `workspace-dev`.

This document explains who can make decisions for the repository, how releases
and protected-branch promotions are approved, how breaking changes are handled,
and what happens if the primary maintainer is unavailable.

This is a lightweight maintainer policy for this repository. It is not a legal
charter, foundation constitution, or separate contributor license regime.

## Maintainer Roster

| Maintainer | Role | Contact |
| --- | --- | --- |
| Oliver Scharkowski (`@oscharko`) | Primary maintainer, release authority, final escalation point | GitHub issues and pull requests in `oscharko-dev/workspace-dev`; private security intake via [security@oscharko.dev](mailto:security@oscharko.dev) |
| `@oscharko-dev` | Backup maintainer handle for repository ownership continuity, CODEOWNERS review, and succession handoff | GitHub repository ownership controls in `oscharko-dev/workspace-dev`; private security intake via [security@oscharko.dev](mailto:security@oscharko.dev) |

General support is handled through GitHub issues. Security-sensitive reports
must use the private channel in `SECURITY.md`.

## Governance Scope

Maintainers are responsible for:

- triaging and prioritizing issues and pull requests
- approving and merging changes into protected branches
- keeping release, compliance, and security documentation accurate
- publishing releases through the approved GitHub Actions workflow
- keeping continuity and escrow procedures current

Contributors may propose changes through issues and pull requests, but
maintainers decide when work is ready to merge or release.

## Release Authority Matrix

This repository uses the documented branch flow `dev -> dev-gate -> main`.
The approval counts below are repository governance policy. GitHub branch
protections and rulesets may enforce the same controls or stricter controls over
time, but this document defines the maintainer review requirement even when the
platform setting is less strict.

| Surface | Who may approve or merge | Required approval count | Additional requirements |
| --- | --- | --- | --- |
| Pull request into `dev` | A listed maintainer | 1 maintainer approval | Relevant local verification complete and required CI green |
| Promotion from `dev` to `dev-gate` | A listed maintainer | 1 maintainer approval | Source branch must be `dev`; quality-gate checks must pass |
| Promotion from `dev-gate` to `main` | A listed maintainer | 1 maintainer approval | Source branch must be `dev-gate`; release checks must pass |
| npm release publish | Primary maintainer, or backup maintainer during succession handling | 1 acting release maintainer | Publish only from the approved GitHub Actions release workflow on `main` after all quality gates pass |

Operational notes:

- `dev-gate` only accepts merges from `dev`.
- `main` only accepts merges from `dev-gate`.
- `CODEOWNERS` assigns repository ownership to `@oscharko-dev`; branch
  protections or rulesets may additionally require code-owner review.
- The release path uses GitHub Actions with OIDC trusted publishing and npm
  provenance for public releases.

## Change Decision Flow

### Standard changes

1. Open or link a GitHub issue that explains the problem and intended outcome.
2. Submit a pull request against `dev`.
3. Complete the relevant verification for the scope of the change.
4. Obtain one maintainer approval.
5. Merge to `dev`, then promote through `dev-gate` and `main` when the release
   flow is ready and all required checks are green.

### Breaking changes

Breaking changes require an explicit decision record in the issue or pull
request before merge.

Minimum requirements:

1. Open a dedicated issue or RFC-style issue that clearly states the breaking
   behavior, affected users, migration path, and semver impact.
2. Keep the proposal open for at least 7 calendar days before merge, unless the
   change is required for a security incident, supply-chain response, or
   release-blocking defect.
3. Obtain approval from the primary maintainer. If the primary maintainer is
   unavailable under the succession policy below, the backup maintainer may act
   as approver.
4. Update any required release notes, changelogs, compatibility docs, or public
   migration guidance in the same change set.

Default outcome when the proposal is not yet clear, safe, or sufficiently
reviewed: do not merge.

## Contributor Ladder

`workspace-dev` uses a simple contributor ladder:

1. Contributor: opens issues, submits pull requests, improves tests and docs,
   and participates in technical review.
2. Trusted contributor: consistently lands high-quality changes, follows the
   repository release and documentation discipline, and can be asked to help
   with deeper review or incident analysis.
3. Maintainer: is explicitly designated by the acting maintainer, is added to
   the maintainer roster in this document, and receives the required repository
   or release ownership controls.

Promotion to maintainer requires all of the following:

- a visible history of high-signal contributions and review participation
- familiarity with the release, security, and compliance documents in this
  repository
- agreement to follow the release authority and succession rules in this
  document
- a governance update that adds the maintainer here and updates any required
  ownership controls such as CODEOWNERS or release access

## Conflict Resolution

Maintainers and contributors should resolve disagreements in the issue or pull
request where the work is being discussed.

If consensus is not reached:

1. Try to converge on a documented decision in the active issue or PR.
2. If disagreement remains after 5 business days, the primary maintainer makes
   the final decision.
3. If the primary maintainer is unavailable or is the subject of the dispute,
   the backup maintainer makes the decision.
4. If neither maintainer can make a timely decision, the default is no merge
   until the issue is explicitly resolved.

## Succession And Continuity

If the primary maintainer is unavailable for more than 5 business days during an
active release, security incident, or release-blocking issue:

- the backup maintainer becomes the acting maintainer for merge and release
  decisions
- the acting maintainer follows `ESCROW.md`, `SECURITY.md`, `SUPPORT.md`, and
  the release workflow evidence requirements before publishing or promoting
  changes
- any manual credential recovery or ownership recovery must be documented in the
  relevant private operating channel and reflected in repository settings after
  service is restored

Continuity expectations:

- release continuity relies on the GitHub repository, CODEOWNERS ownership,
  GitHub Actions release workflow, npm trusted publishing configuration, and
  the escrow artifact set documented in `ESCROW.md`
- if the primary maintainer is expected to be unavailable for longer than 30
  calendar days, the acting maintainer should designate at least one additional
  human maintainer and update this document, CODEOWNERS, and release ownership
  controls in the same governance change

## Review Cadence

This document should be reviewed:

- when the maintainer roster changes
- when branch protections, rulesets, or release authority change
- when trusted publishing or escrow procedures change
- at least quarterly as part of the repository compliance review cadence
