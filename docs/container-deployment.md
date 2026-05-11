# Container Deployment

`workspace-dev` remains an npm-first package. The repository also provides a reference container image for enterprise teams that need a repeatable Docker or Compose deployment path.

## Build The Image

```bash
docker build -t workspace-dev:local .
docker run --rm workspace-dev:local --help
```

The image uses a multi-stage build:

- build stage: installs pinned pnpm dependencies and runs `pnpm run build`
- runtime stage: starts from `node:22-bookworm-slim`, copies built artifacts and template assets, exposes port `1983`, and sets `workspace-dev` as the entrypoint

## Run Locally

```bash
docker compose up --build
```

The Compose service binds the container to `127.0.0.1:1983` on the host and writes runtime state to a Docker-managed `workspace-dev-data` volume.

## Runtime Configuration

Containerized deployments should set the server bind address explicitly:

```bash
workspace-dev start --host 0.0.0.0 --port 1983 --output-root /workspace/.workspace-dev
```

Relevant environment variables:

- `FIGMAPIPE_WORKSPACE_HOST=0.0.0.0`
- `FIGMAPIPE_WORKSPACE_PORT=1983`
- `FIGMAPIPE_WORKSPACE_OUTPUT_ROOT=/workspace/.workspace-dev`

Operational notes:

- Keep the host-side port binding restricted to loopback unless a trusted reverse proxy owns TLS, authentication, and network exposure.
- Mount `/workspace/.workspace-dev` as a volume when job artifacts, generated apps, repro bundles, and local JSON handoff files must survive container replacement. Prefer a Docker-managed named volume for one-command Linux setups; if you bind-mount a host directory, ensure the non-root container user can write it.
- Use `figmaSourceMode=local_json` for air-gapped smoke tests and pre-baked Figma exports. The submitted `figmaJsonPath` must be readable inside the container.
- Keep `NO_PROXY` aligned for `127.0.0.1`, `localhost`, and `::1` when running behind a corporate proxy.

## Local JSON Smoke Test

Start the container:

```bash
docker volume create workspace-dev-data
docker run --rm -p 127.0.0.1:1983:1983 \
  -v workspace-dev-data:/workspace/.workspace-dev \
  -v "$PWD/src/parity/fixtures/golden/rocket/simple-auth/figma.json:/workspace/fixtures/simple-auth.json:ro" \
  workspace-dev:local \
  start --host 0.0.0.0 --port 1983 --output-root /workspace/.workspace-dev --export-images false
```

Submit a deterministic local JSON job:

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{
    "figmaSourceMode":"local_json",
    "llmCodegenMode":"deterministic",
    "figmaJsonPath":"/workspace/fixtures/simple-auth.json",
    "enableGitPr":false
  }'
```

Then poll `GET /workspace/jobs/<jobId>` until `status` is `completed`, and fetch `GET /workspace/jobs/<jobId>/result` to confirm `outcome` is `success`.
