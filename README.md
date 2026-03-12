# workspace-dev

Local mode-locked workspace status and validation server for FigmaPipe development.

The package exposes deterministic local endpoints and does not execute Figma fetch, LLM codegen, or filesystem output.

## Prerequisites

- Node.js `>=22.0.0` (validated on 22.x and 24.x)
- npm `>=10` or pnpm `>=10`

## Installation

```bash
npm install --save-dev workspace-dev
```

## Quickstart

```bash
# Preferred binary name
npx workspace-dev start

# Backward-compatible alias
npx figmapipe-workspace-dev start
```

Server defaults to `http://127.0.0.1:1983`.

## API Surface

- `GET /workspace` - runtime status
- `GET /healthz` - readiness probe
- `POST /workspace/submit` - request validation + mode-lock enforcement (returns deterministic `501` for execution path)

## Module Usage

### ESM

```ts
import { createWorkspaceServer } from "workspace-dev";

const server = await createWorkspaceServer({ host: "127.0.0.1", port: 1983 });
await server.app.close();
```

### CommonJS

```js
const { createWorkspaceServer } = require("workspace-dev");

async function main() {
  const server = await createWorkspaceServer({ host: "127.0.0.1", port: 1983 });
  await server.app.close();
}

main();
```

## Air-Gap / Offline Installation

```bash
# 1) Create tarball in a connected build environment
npm pack

# 2) Install in an offline environment (no registry access)
npm install --offline --ignore-scripts ./workspace-dev-<version>.tgz
```

`workspace-dev` has zero runtime dependencies and no install lifecycle scripts.

## Configuration

| Option | CLI Flag | Env Var | Default |
| --- | --- | --- | --- |
| Port | `--port` | `FIGMAPIPE_WORKSPACE_PORT` | `1983` |
| Host | `--host` | `FIGMAPIPE_WORKSPACE_HOST` | `127.0.0.1` |

## Mode Lock

Only the following runtime modes are allowed:

- `figmaSourceMode=rest`
- `llmCodegenMode=deterministic`

Unsupported modes (`mcp`, `hybrid`, `llm_strict`) return deterministic `MODE_LOCK_VIOLATION` responses.

## Runtime Validation Error Envelope

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "issues": [
    {
      "path": "figmaFileKey",
      "message": "figmaFileKey is required"
    }
  ]
}
```

## Testing

```bash
pnpm run typecheck
pnpm run test
pnpm run test:coverage
pnpm run lint:boundaries
pnpm run build
```

## Related Governance Docs

- `SECURITY.md`
- `COMPLIANCE.md`
- `ARCHITECTURE.md`
- `COMPATIBILITY.md`
- `ZERO_TELEMETRY.md`

## License

MIT
