/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "pnpm",
  testRunner: "tap",
  coverageAnalysis: "perTest",
  checkers: ["typescript"],
  plugins: [
    "@stryker-mutator/tap-runner",
    "@stryker-mutator/typescript-checker",
  ],
  mutate: [
    "src/mode-lock.ts",
    "src/schemas.ts",
    "src/server/request-security.ts",
    "src/job-engine/pipeline/orchestrator.ts",
    "src/job-engine/visual-scoring.ts",
    "src/job-engine/figma-mcp-resolver.ts",
    "src/job-engine/figma-token-bridge.ts",
    "src/job-engine/figma-component-mapper.ts",
    "src/job-engine/import-session-event-store.ts",
    "src/job-engine/paste-fingerprint-store.ts",
    "src/job-engine/paste-tree-diff.ts",
    "src/parity/ir.ts",
    "src/parity/ir-design-context.ts",
  ],
  reporters: ["clear-text", "json", "html"],
  htmlReporter: {
    fileName: "artifacts/testing/mutation/mutation.html",
  },
  jsonReporter: {
    fileName: "artifacts/testing/mutation/mutation.json",
  },
  tempDirName: "artifacts/testing/.stryker-tmp",
  ignorePatterns: [
    "artifacts/**/*",
    "coverage/**/*",
    "dist/**/*",
    "playwright-report/**/*",
    "template/react-mui-app/artifacts/**/*",
    "template/react-mui-app/dist/**/*",
    "test-results/**/*",
  ],
  thresholds: {
    high: 58,
    low: 58,
    break: 58,
  },
  tsconfigFile: "tsconfig.json",
  typescriptChecker: {
    prioritizePerformanceOverAccuracy: false,
  },
  tap: {
    testFiles: [
      "src/mode-lock.test.ts",
      "src/schemas.test.ts",
      "src/server/request-security.test.ts",
      "src/job-engine/pipeline/orchestrator.test.ts",
      "src/job-engine/visual-scoring.test.ts",
      "src/job-engine/figma-mcp-resolver.test.ts",
      "src/job-engine/figma-token-bridge.test.ts",
      "src/job-engine/figma-component-mapper.test.ts",
      "src/job-engine/import-session-event-store.test.ts",
      "src/job-engine/paste-fingerprint-store.test.ts",
      "src/job-engine/paste-tree-diff.test.ts",
      "src/parity/ir.test.ts",
      "src/parity/ir-design-context.test.ts",
    ],
    nodeArgs: [
      "--test-reporter=tap",
      "-r",
      "{{hookFile}}",
      "--import",
      "tsx",
      "{{testFile}}",
    ],
  },
};

export default config;
