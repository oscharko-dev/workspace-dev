# Default demo fixture pack

The default pipeline demo pack is the OSS-neutral financial-services fixture set
under `src/parity/fixtures/golden/default`.

These fixtures are local JSON inputs for deterministic generation. They do not
require a Figma token, customer profile, proprietary asset, or customer-specific
mapping. All business values are synthetic demo values.

For the end-to-end install, source-mode, pipeline-selection, runtime demo,
quality-passport, warning, and troubleshooting runbook, see
[default-demo-guide.md](default-demo-guide.md).

## Coverage

| Fixture                    | Scenario                          | Surface   | Primary coverage                                                  |
| -------------------------- | --------------------------------- | --------- | ----------------------------------------------------------------- |
| `fintech-dashboard`        | Global banking dashboard          | Board     | Board generation, financial dashboard layout, validation evidence |
| `login-mfa`                | Login and MFA entry view          | View      | Authentication view generation                                    |
| `payment-card`             | Payment authorization cards       | Component | Reusable component extraction from repeated cards                 |
| `forms`                    | Financial onboarding form         | View      | Form-heavy generation                                             |
| `responsive-marketing`     | Responsive banking portal page    | View      | Responsive layout generation                                      |
| `dense-table`              | Transaction table view            | View      | Dense table generation                                            |
| `mobile-navigation`        | Mobile banking navigation board   | Board     | Multi-view mobile navigation generation                           |
| `design-token-heavy-board` | Token-heavy risk operations board | Board     | Light/dark token extraction and token reports                     |
| `risk-alert-modal`         | Risk alert modal                  | View      | Modal-style alert content                                         |
| `unsupported-nodes`        | Unsupported pattern coverage      | View      | Unsupported-node report coverage                                  |

The pack contract is declared in
`src/parity/fixtures/golden/default/manifest.json` and enforced by
`src/parity/golden-fixtures.test.ts`.

## Verification

Run the deterministic fixture check with:

```sh
pnpm run test:golden
```

Intentional fixture or generator snapshot updates must go through:

```sh
FIGMAPIPE_GOLDEN_APPROVE=true pnpm run test:golden
```
