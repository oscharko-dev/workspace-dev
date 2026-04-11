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
    "src/parity/ir.ts",
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
    high: 62,
    low: 62,
    break: null,
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
      "src/parity/ir.test.ts",
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
