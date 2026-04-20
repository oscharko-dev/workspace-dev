# TROUBLESHOOTING

Use this guide for the first operator-visible failures that tend to block local installs, runtime startup, and submit-time validation. It stays intentionally narrow: symptom, cause, resolution, then a pointer back to the canonical docs when you need the full workflow.

## Node.js Version Mismatch

**Symptom**

- `workspace-dev` fails to start.
- npm or pnpm reports an unsupported engine warning or error.

**Cause**

- The repository requires Node.js `>=22.0.0`, but the active shell is using an older runtime.

**Resolution**

1. Confirm the current runtime:

```bash
node -v
```

2. Switch to the project-compatible runtime. If you use `nvm`, prefer the project pin when present:

```bash
nvm use
```

3. If your machine does not already have a compatible Node.js runtime installed, install Node.js `>=22` first, then rerun `nvm use` or restart your shell on the newly installed version.

Canonical repo anchors:

- [README.md](README.md)
- [docs/enterprise-quickstart.md](docs/enterprise-quickstart.md)

## pnpm Install / Cache Failures

**Symptom**

- `pnpm install` fails with dependency resolution errors.
- The lockfile or `node_modules` tree appears corrupted or out of sync.

**Cause**

- The local pnpm store is stale, the network or registry path is unavailable, the checkout has lockfile drift, or an earlier install left behind an inconsistent `node_modules` tree.

**Resolution**

1. Prune unreferenced store entries:

```bash
pnpm store prune
```

2. Remove the local install tree:

```bash
rm -rf node_modules
```

3. Reinstall dependencies:

```bash
pnpm install
```

4. If the reinstall is still unhealthy, force a clean dependency refresh:

```bash
pnpm install --force
```

If you are working in an air-gapped or controlled environment, use the stricter install guidance in [docs/enterprise-quickstart.md](docs/enterprise-quickstart.md) instead of the default online flow.

## Port 1983 Collision

**Symptom**

- Startup fails with `EADDRINUSE`.
- The runtime reports that port `1983` is already in use.

**Cause**

- Another `workspace-dev` instance or another local service is already bound to `127.0.0.1:1983`.

**Resolution**

1. Identify the process using the default port:

```bash
lsof -i :1983
```

2. Stop the conflicting process, then start `workspace-dev` again.
3. If you need to keep the other process running, start `workspace-dev` on an alternative port:

```bash
FIGMAPIPE_WORKSPACE_PORT=21983 npx workspace-dev start
```

The default runtime URLs in [README.md](README.md) assume port `1983`, so update your browser or client target if you choose a different port.

## figmaSourceMode Input Errors

**Symptom**

- Submit fails with `MODE_LOCK_VIOLATION`.
- Submit fails with an invalid-input error for `figmaSourceMode` or `figmaJsonPath`.

**Cause**

- The request uses an unsupported `figmaSourceMode`, mixes incompatible fields, or points `local_json` at a file that does not exist.

**Resolution**

1. For file-key or local-path submit requests, use only `rest`, `hybrid`, or `local_json`.
2. When using `local_json`, make sure the file exists before you submit:

```bash
test -f /absolute/path/to/figma.json
```

3. Align the payload with the selected mode:
   `rest` and `hybrid` require `figmaFileKey` plus `figmaAccessToken`, while `local_json` requires `figmaJsonPath`.
4. If you are using clipboard, drag-and-drop, or plugin-export flows instead of a direct API submit, use the dedicated guidance in [docs/figma-import.md](docs/figma-import.md). Those UI flows use `figma_paste` or `figma_plugin`, not `local_json`.

## Validation Stage Failures (`validate.project`)

**Symptom**

- A job reaches `validate.project` and then fails.
- The validation output reports TypeScript errors, ESLint violations, or generated-project install failures.

**Cause**

- The generated project does not currently satisfy the validation gate, or the template/install state has drifted from the checked-in baseline.

**Resolution**

1. Inspect the job log and captured validation output for the exact failing command.
2. If the failure is TypeScript- or ESLint-related, compare the generated output against the current template baseline and rerun after updating the template or inputs that caused the drift.
3. If the failure is install-related, verify the template dependency tree separately before rerunning the job:

```bash
pnpm run template:install
```

The canonical pipeline overview is in [PIPELINE.md](PIPELINE.md).

## Template Dependency Issues

**Symptom**

- `template.prepare` fails.
- `validate.project` fails with missing packages or template dependency errors.

**Cause**

- `template/react-mui-app/pnpm-lock.yaml` is stale, corrupted, or no longer matches the checked-in template dependency graph.

**Resolution**

1. Verify the template lockfile and install state directly:

```bash
cd template/react-mui-app && pnpm install --frozen-lockfile
```

2. If that command fails, repair the template dependency state in the repository before rerunning the job.
3. Once the template install is healthy again, rerun the original `workspace-dev` workflow.

## See Also

- [README.md](README.md)
- [PIPELINE.md](PIPELINE.md)
- [docs/enterprise-quickstart.md](docs/enterprise-quickstart.md)
- [docs/figma-import.md](docs/figma-import.md)
- [docs/local-runtime.md](docs/local-runtime.md)
