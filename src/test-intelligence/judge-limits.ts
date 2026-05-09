export const INSTRUCTION_LENGTH_LIMITS = {
  severityLabel: 32,
  code: 64,
  path: 160,
  message: 240,
  instruction: 240,
} as const;

export interface TruncationResult {
  readonly value: string;
  readonly truncated: boolean;
}

export const truncateWithEllipsis = (
  value: string,
  maxLength: number,
): TruncationResult => {
  if (value.length <= maxLength) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, Math.max(0, maxLength - 3))}...`,
    truncated: true,
  };
};

export const truncateInstructionWithAudit = (
  value: string,
): TruncationResult =>
  truncateWithEllipsis(value, INSTRUCTION_LENGTH_LIMITS.instruction);

export const countTruncatedInstructions = (
  repairInstructions: ReadonlyArray<{ instructionTruncated?: boolean }>,
): number =>
  repairInstructions.filter(
    (instruction) => instruction.instructionTruncated === true,
  ).length;
