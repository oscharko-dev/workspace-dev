# Enterprise Quickstart

Use this guide when `workspace-dev` must run inside a controlled environment with no outbound public internet access, a private registry, or an explicit proxy/firewall path. This stays intentionally narrow: install an approved package, verify release evidence, run one proven `local_json` smoke test, and link out to the canonical security/compliance docs instead of duplicating them.

## Scope

- Install `workspace-dev` from a local tarball or an internal npm-compatible registry.
- Verify signatures and provenance with the current npm command.
- Run one repository-root `local_json` job that avoids Figma network calls.
- Capture the proxy and firewall settings that matter for package resolution and localhost runtime use.
- Use the reference container setup when your enterprise deployment standard requires Docker or Compose.

## Prerequisites

- Node.js `>=22.0.0`
- npm `>=10` or pnpm `>=10`
- An approved `workspace-dev` release artifact path:
  - a transferred `workspace-dev-<version>.tgz`
  - an internal npm-compatible registry entry for `workspace-dev@<version>`
- For the smoke test in this document, run commands from the repository root so these checked-in paths exist:
  - `dist/cli.cjs`
  - `src/parity/fixtures/golden/rocket/simple-auth/figma.json`

## 1. Air-gap Install From A Local Tarball

1. On an approved connected build or release host, create the package tarball from the source checkout:

```bash
pnpm pack --pack-destination ./artifacts/airgap
```

2. Transfer `./artifacts/airgap/workspace-dev-<version>.tgz` into the controlled environment.
3. In the target project, ensure a `package.json` already exists or initialize one:

```bash
npm init -y
```

4. Install from the local tarball with the same offline pattern the repository verifies in `pnpm run verify:airgap`:

```bash
npm install --offline --ignore-scripts /absolute/path/to/workspace-dev-<version>.tgz
```

5. Confirm the installed package exposes the local binary without using `npx`:

```bash
./node_modules/.bin/workspace-dev --help
```

## 2. Air-gap Install From A Private Registry

1. Mirror or promote the approved `workspace-dev@<version>` package into your internal registry.
2. Point npm and pnpm at that internal registry:

```ini
registry=https://registry.corp.example/npm/
```

3. Install the approved version without lifecycle scripts:

```bash
npm install --ignore-scripts workspace-dev@<version>
```

4. If you require strict store-only pnpm installs after the store is pre-seeded, use `pnpm install --offline`. Do not rely on `--prefer-offline` for a hard no-egress guarantee; it can still request missing data from the registry.

## 3. Provenance And Release Evidence

Run the current npm signatures and provenance verification command in the project where `workspace-dev` is installed:

```bash
npm audit signatures
```

Expected result:

- Success output reports verified registry signatures.
- When the registry preserves attestations, npm also reports verified attestations.
- If signatures or attestations are missing or invalid, treat that as a release-evidence failure and stop before promoting the package.

For deeper release evidence and SBOM policy, use the canonical repository docs instead of copying them into local runbooks:

- [COMPLIANCE.md](../COMPLIANCE.md)
- [SECURITY.md](../SECURITY.md)
- [THREAT_MODEL.md](../THREAT_MODEL.md)

## 4. First Successful `local_json` Run

This smoke test is intentionally repository-root scoped. It uses the smallest checked-in fixture and avoids Figma REST or MCP calls by submitting `figmaSourceMode=local_json`.

Terminal 1, from the repository root:

```bash
node ./dist/cli.cjs start --host 127.0.0.1 --port 21983 --output-root .workspace-dev
```

Terminal 2, still from the repository root:

```bash
SUBMIT_RESPONSE="$(curl -sS -X POST http://127.0.0.1:21983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{"figmaSourceMode":"local_json","llmCodegenMode":"deterministic","figmaJsonPath":"src/parity/fixtures/golden/rocket/simple-auth/figma.json"}')"

printf '%s\n' "$SUBMIT_RESPONSE"

JOB_ID="$(printf '%s' "$SUBMIT_RESPONSE" | node -e "let s=''; process.stdin.on('data', (d) => s += d); process.stdin.on('end', () => process.stdout.write(JSON.parse(s).jobId));")"

JOB_ID="$JOB_ID" node - <<'EOF'
const jobId = process.env.JOB_ID;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (;;) {
  const statusResponse = await fetch(`http://127.0.0.1:21983/workspace/jobs/${jobId}`);
  const status = await statusResponse.json();

  console.log(JSON.stringify({
    jobId: status.jobId,
    status: status.status,
    currentStage: status.currentStage,
    outcome: status.outcome
  }, null, 2));

  if (["completed", "failed", "canceled"].includes(status.status)) {
    const resultResponse = await fetch(`http://127.0.0.1:21983/workspace/jobs/${jobId}/result`);
    const result = await resultResponse.json();

    console.log(JSON.stringify({
      jobId: result.jobId,
      status: result.status,
      outcome: result.outcome,
      summary: result.summary,
      artifacts: result.artifacts
    }, null, 2));

    break;
  }

  await sleep(1000);
}
EOF
```

Expected output:

- The initial submit response prints a JSON object with `status: "queued"` and `acceptedModes.figmaSourceMode: "local_json"`.
- The poll loop ends with `status: "completed"` and `outcome: "success"`.
- The final result payload reports artifact paths under `.workspace-dev/jobs/<jobId>/`, including:
  - `.workspace-dev/jobs/<jobId>/figma.json`
  - `.workspace-dev/jobs/<jobId>/design-ir.json`
  - `.workspace-dev/jobs/<jobId>/generated-app/`
- The runtime stays on loopback (`127.0.0.1`) and the `local_json` path avoids outbound Figma calls.

## 5. Proxy And Firewall Notes

Set corporate proxy environment variables only when package-manager traffic must traverse them:

```bash
export HTTPS_PROXY=http://proxy.corp.example:8080
export HTTP_PROXY=http://proxy.corp.example:8080
export NO_PROXY=127.0.0.1,localhost,::1
```

Use the same registry and proxy policy in `.npmrc`; npm and pnpm both honor these keys:

```ini
registry=https://registry.corp.example/npm/
https-proxy=http://proxy.corp.example:8080
proxy=http://proxy.corp.example:8080
noproxy=127.0.0.1,localhost,::1
```

Operational notes:

- Keep `NO_PROXY` and `noproxy` aligned for `127.0.0.1`, `localhost`, and `::1`. Otherwise browser or `curl` traffic to the local runtime can be sent to the corporate proxy by mistake.
- For this quickstart, the required network paths are loopback plus your approved package source. `figmaSourceMode=local_json` does not require Figma API access.
- `validate.project` can still need package resolution for the generated app. In a controlled environment, satisfy that through a pre-seeded pnpm store or an internal registry mirror.
- If you later switch to `figmaSourceMode=rest` or `figmaSourceMode=hybrid`, allow outbound access to the Figma REST API and any configured MCP endpoint. See [docs/figma-import.md](./figma-import.md) for the mode-specific import paths.

## See Also

- [README.md](../README.md)
- [docs/container-deployment.md](./container-deployment.md)
- [docs/local-runtime.md](./local-runtime.md)
- [docs/figma-import.md](./figma-import.md)
- [SECURITY.md](../SECURITY.md)
- [COMPLIANCE.md](../COMPLIANCE.md)
- [THREAT_MODEL.md](../THREAT_MODEL.md)
