# Template Maintenance

The bundled React templates in `template/react-mui-app/` and
`template/react-tailwind-app/` are part of the published package contract.
Dependency updates must be deliberate, reviewable, and validated against
generated-app behavior before they reach `dev`.

## Dependency Update Cadence

- Evaluate patch and minor updates monthly for all runtime and development
  dependencies in `template/react-mui-app/package.json` and
  `template/react-tailwind-app/package.json`.
- Evaluate major updates quarterly, or sooner when a security advisory or
  platform end-of-life notice makes the update urgent.
- Do not mix routine template dependency updates with template architecture
  changes. Use a dedicated PR for dependency-only maintenance.
- Keep the matching template `pnpm-lock.yaml` in the same PR as any template
  dependency manifest change.

Security fixes may bypass the monthly or quarterly cadence when the advisory
risk justifies it. The PR must document the advisory, the affected dependency
path, and any validation that differs from the normal gates.

## Required Validation

Before merging a template dependency update, run the smallest relevant local
checks plus the template validation gates:

```bash
pnpm run template:install
pnpm run template:test
pnpm --dir template/react-mui-app run typecheck
pnpm --dir template/react-mui-app run build
pnpm run template:tailwind:install
pnpm run template:tailwind:dependency-denylist
pnpm run template:tailwind:lint
pnpm run template:tailwind:typecheck
pnpm run template:tailwind:test
pnpm run template:tailwind:build
pnpm run template:tailwind:validate:ui
pnpm run template:tailwind:validate:playwright
pnpm run verify:lockfile-hosts
pnpm run verify:docs-template-stack
```

`template:tailwind:validate:playwright` runs the generated app through the
desktop, tablet, and mobile Chromium viewport matrix. The gate captures
reviewer-visible screenshots, checks for horizontal layout collapse, enforces a
stable recapture diff threshold, and writes visual audit reports under
`template/react-tailwind-app/artifacts/visual-audit/`.
When `validate.project` runs on the default pipeline, generated default apps
invoke the same `validate:playwright` script and place these artifacts under
the job's `ui-gate/visual-audit/` directory.

When the update can affect generated output, also run golden fixture parity:

```bash
pnpm run test:golden
```

When the update can affect runtime rendering, Vite output, or browser behavior,
also run the generated-app validation path:

```bash
pnpm benchmark:visual
pnpm --dir template/react-mui-app run perf:assert
pnpm run perf:web:tailwind:baseline:gate
pnpm run perf:web:tailwind:assert
```

Reviewers should confirm that generated fixture diffs, performance deltas, and
lockfile changes are expected for the dependency being updated.

For `template/react-tailwind-app/` story-completion evidence, the minimum
demonstration path is:

```bash
pnpm run template:tailwind:install
pnpm run template:tailwind:dependency-denylist
pnpm run template:tailwind:lint
pnpm run template:tailwind:typecheck
pnpm run template:tailwind:test
pnpm run template:tailwind:build
pnpm run template:tailwind:validate:ui
pnpm run template:tailwind:validate:playwright
pnpm run perf:web:tailwind:baseline:gate
pnpm run perf:web:tailwind:assert
pnpm exec tsx --test src/react-tailwind-template.test.ts
node --test scripts/check-default-template-denylist.test.mjs
pnpm exec tsx --test src/package-distribution.test.ts
```

This path proves the OSS template can be installed, compiled, tested, packed,
validated in a browser, performance-checked, and kept free of hidden MUI,
Emotion, Rocket/customer, telemetry, or proprietary-asset dependencies.

## Default Template Dependency Boundary

`template/react-tailwind-app/` is the OSS default template. It must stay free of
MUI, Emotion, Rocket or customer-specific libraries, proprietary static assets,
and telemetry SDK dependencies.

The release gate `pnpm run template:tailwind:dependency-denylist` enforces that
boundary by checking:

- direct dependency declarations in `template/react-tailwind-app/package.json`;
- direct root-importer and package graph entries in
  `template/react-tailwind-app/pnpm-lock.yaml`;
- non-test source imports in the shipped template files;
- bundled static asset file types such as images, icons, fonts, and media.

Do not bypass this check by moving a denied library into `devDependencies`,
`pnpm.overrides`, a template script, or a lockfile-only entry. If a dependency
pulls a denied transitive package, replace that dependency rather than
allowlisting the telemetry or customer-specific SDK. If the default template
ever needs an OSS static asset, document its source, license, hash, and reason
in the PR before adding an explicit narrow exception to
`scripts/check-default-template-denylist.mjs`.

## Communication

- Add a `CHANGELOG.md` entry for every template dependency update that changes
  generated app behavior, build requirements, runtime behavior, or security
  posture.
- Bump the public contract version and add a `CONTRACT_CHANGELOG.md` entry when
  a template dependency update changes generated-app contracts, required Node or
  package-manager versions, exported runtime assumptions, or consumer migration
  requirements.
- Call out major-version evaluations in the PR body even when the decision is to
  defer the bump.
- Link any automation-created freshness issue from the dependency update PR.

## Automation

`.github/workflows/template-dependency-freshness.yml` runs weekly and can also
be dispatched manually. It checks `template/react-mui-app/package.json` and
`template/react-mui-app/pnpm-lock.yaml`, plus
`template/react-tailwind-app/package.json` and
`template/react-tailwind-app/pnpm-lock.yaml`, against npm registry publish
times, then opens or updates a GitHub issue when a same-major minor or patch
update has been available for more than 30 days and the lockfile baseline has
not caught up.

The automation intentionally ignores newer major versions. Major upgrades remain
quarterly maintainer decisions because they can require generated-app migration
work, browser support review, and contract-version handling.

## Renovate and Dependabot Policy

Dependabot is enabled separately for the repository root and
`/template/react-mui-app` and `/template/react-tailwind-app` in
`.github/dependabot.yml`. Keep template dependency PRs separate from root
dependency PRs so generated-app risk can be reviewed on its own.

Renovate is not required while Dependabot covers the template package directory.
Re-evaluate Renovate only if maintainers need dependency grouping, custom
schedule rules, or dashboard behavior that Dependabot cannot provide without
adding equivalent complexity.
