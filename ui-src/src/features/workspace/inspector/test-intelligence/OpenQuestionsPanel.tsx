import type { JSX } from "react";
import type { GeneratedTestCase } from "./types";

export interface OpenQuestionsPanelProps {
  testCases: readonly GeneratedTestCase[];
}

export function OpenQuestionsPanel({
  testCases,
}: OpenQuestionsPanelProps): JSX.Element {
  const items = testCases.flatMap((testCase) => [
    ...testCase.assumptions.map((value) => ({
      kind: "assumption" as const,
      testCaseId: testCase.id,
      value,
    })),
    ...testCase.openQuestions.map((value) => ({
      kind: "open question" as const,
      testCaseId: testCase.id,
      value,
    })),
  ]);

  if (items.length === 0) {
    return (
      <section
        data-testid="ti-open-questions-panel"
        aria-label="Open assumptions and questions"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No open assumptions or questions are recorded in the generated cases.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-open-questions-panel"
      aria-label="Open assumptions and questions"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">
          Open assumptions and questions
        </h2>
        <span className="text-[10px] text-white/45">{items.length} items</span>
      </header>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item, index) => (
          <li
            key={`${item.testCaseId}-${item.kind}-${index}`}
            className="rounded border border-white/5 bg-[#0f0f0f] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-white/85">
                {item.testCaseId}
              </span>
              <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/55">
                {item.kind}
              </span>
            </div>
            <p className="m-0 mt-1 text-[11px] text-white/65">{item.value}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
