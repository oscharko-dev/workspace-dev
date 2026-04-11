import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runVisualAudit,
  type VisualAuditDependencies,
  type VisualAuditFixtureResult,
  type VisualAuditReport,
  type VisualAuditScreenResult,
} from "./visual-audit.js";

const MODULE_FILE = fileURLToPath(import.meta.url);

export type VisualAuditCommand = "live";

export interface VisualAuditCliOptions {
  command: VisualAuditCommand;
  json: boolean;
  fixture?: string;
  driftThreshold?: number;
  regressionThreshold?: number;
}

const VALID_COMMANDS: readonly VisualAuditCommand[] = ["live"];
const USAGE = "Usage: pnpm visual:audit live [options]";

const parseThreshold = (label: string, raw: string | undefined): number => {
  if (raw === undefined) {
    throw new Error(`${label} requires a value. ${USAGE}`);
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a numeric threshold. ${USAGE}`);
  }
  if (parsed < 0 || parsed > 100) {
    throw new Error(`${label} must be between 0 and 100. ${USAGE}`);
  }
  return parsed;
};

const readOptionValue = (
  label: string,
  args: readonly string[],
  index: number,
): string => {
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) {
    throw new Error(`${label} requires a value. ${USAGE}`);
  }
  return next;
};

export const parseVisualAuditCliArgs = (
  args: readonly string[],
): VisualAuditCliOptions => {
  const filtered = args[0] === "--" ? args.slice(1) : [...args];
  if (filtered.length === 0) {
    throw new Error(USAGE);
  }
  const command = filtered[0];
  if (!VALID_COMMANDS.includes(command as VisualAuditCommand)) {
    throw new Error(`Unknown command '${String(command)}'. ${USAGE}`);
  }
  let json = false;
  let fixture: string | undefined;
  let driftThreshold: number | undefined;
  let regressionThreshold: number | undefined;
  for (let i = 1; i < filtered.length; i++) {
    const arg = filtered[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--fixture") {
      fixture = readOptionValue("--fixture", filtered, i);
      i += 1;
    } else if (arg === "--drift-threshold") {
      driftThreshold = parseThreshold(
        "--drift-threshold",
        readOptionValue("--drift-threshold", filtered, i),
      );
      i += 1;
    } else if (arg === "--regression-threshold") {
      regressionThreshold = parseThreshold(
        "--regression-threshold",
        readOptionValue("--regression-threshold", filtered, i),
      );
      i += 1;
    } else {
      throw new Error(`Unknown option '${String(arg)}'. ${USAGE}`);
    }
  }
  const options: VisualAuditCliOptions = {
    command: command as VisualAuditCommand,
    json,
  };
  if (fixture !== undefined) {
    options.fixture = fixture;
  }
  if (driftThreshold !== undefined) {
    options.driftThreshold = driftThreshold;
  }
  if (regressionThreshold !== undefined) {
    options.regressionThreshold = regressionThreshold;
  }
  return options;
};

const formatScore = (value: number | null): string =>
  value === null ? "\u2014" : value.toFixed(1);

const formatFixtureLine = (
  fixture: VisualAuditFixtureResult,
  screen: VisualAuditScreenResult,
): string => {
  const drift = formatScore(screen.driftScore);
  const regression = formatScore(screen.regressionScore);
  return `${fixture.fixtureId} / ${screen.screenName} | ${screen.label} | drift=${drift} regression=${regression} | last-known-good=${fixture.lastKnownGoodAt}`;
};

const formatReport = (report: VisualAuditReport): string => {
  const lines: string[] = [];
  lines.push(
    `Audited ${String(report.totalFixtures)} fixture(s) at ${report.auditedAt}`,
  );
  lines.push(
    `  drifted=${String(report.driftedFixtures)} regressed=${String(report.regressedFixtures)}`,
  );
  for (const fixture of report.fixtures) {
    for (const screen of fixture.screens) {
      lines.push(`  ${formatFixtureLine(fixture, screen)}`);
    }
  }
  return `${lines.join("\n")}\n`;
};

const buildDependencies = (
  cliOptions: VisualAuditCliOptions,
): VisualAuditDependencies => {
  const deps: VisualAuditDependencies = {};
  if (cliOptions.fixture !== undefined) {
    deps.fixtureId = cliOptions.fixture;
  }
  if (cliOptions.driftThreshold !== undefined) {
    deps.driftThreshold = cliOptions.driftThreshold;
  }
  if (cliOptions.regressionThreshold !== undefined) {
    deps.regressionThreshold = cliOptions.regressionThreshold;
  }
  return deps;
};

const resolveExitCode = (report: VisualAuditReport): number => {
  const hasIssue = report.fixtures.some(
    (fixture) => fixture.fixtureLabel !== "Stable",
  );
  return hasIssue ? 1 : 0;
};

export const runVisualAuditCli = async (
  args: readonly string[],
  options?: {
    runAudit?: (deps?: VisualAuditDependencies) => Promise<VisualAuditReport>;
  },
): Promise<number> => {
  const cliOptions = parseVisualAuditCliArgs(args);
  const deps = buildDependencies(cliOptions);
  const runner = options?.runAudit ?? runVisualAudit;
  const report = await runner(deps);
  if (cliOptions.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
  return resolveExitCode(report);
};

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void runVisualAuditCli(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
