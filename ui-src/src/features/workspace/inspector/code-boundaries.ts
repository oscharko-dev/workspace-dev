export interface CodeBoundaryEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  startLine: number;
  endLine: number;
}

export interface CodeBoundaryWithLane {
  entry: CodeBoundaryEntry;
  lane: number;
  startLine: number;
  endLine: number;
  color: string;
}

export interface CodeBoundaryLineDisplay {
  visible: CodeBoundaryWithLane[];
  overflowCount: number;
}

export interface CodeBoundaryLayout {
  boundaries: CodeBoundaryWithLane[];
  byLine: Map<number, CodeBoundaryLineDisplay>;
}

const HUE_BUCKETS = 360;

function compareEntries(left: CodeBoundaryEntry, right: CodeBoundaryEntry): number {
  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine;
  }
  if (left.endLine !== right.endLine) {
    return left.endLine - right.endLine;
  }
  return left.irNodeId.localeCompare(right.irNodeId);
}

function normalizeLine(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function clampRange({
  startLine,
  endLine,
  totalLines
}: {
  startLine: number;
  endLine: number;
  totalLines: number;
}): { startLine: number; endLine: number } | null {
  if (totalLines <= 0) {
    return null;
  }

  const normalizedStart = normalizeLine(startLine);
  const normalizedEnd = normalizeLine(endLine);
  const lower = Math.min(normalizedStart, normalizedEnd);
  const upper = Math.max(normalizedStart, normalizedEnd);

  if (lower > totalLines) {
    return null;
  }

  return {
    startLine: Math.max(1, lower),
    endLine: Math.min(totalLines, upper)
  };
}

export function stableBoundaryHue(irNodeId: string): number {
  let hash = 0;
  for (let i = 0; i < irNodeId.length; i += 1) {
    hash = Math.imul(31, hash) + irNodeId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % HUE_BUCKETS;
}

export function resolveBoundaryColor({
  irNodeId,
  isDark
}: {
  irNodeId: string;
  isDark: boolean;
}): string {
  const hue = stableBoundaryHue(irNodeId);
  const saturation = isDark ? 78 : 72;
  const lightness = isDark ? 62 : 42;
  return `hsl(${String(hue)} ${String(saturation)}% ${String(lightness)}%)`;
}

export function buildCodeBoundaryLayout({
  entries,
  totalLines,
  isDark,
  maxVisibleLanes = 3
}: {
  entries: CodeBoundaryEntry[];
  totalLines: number;
  isDark: boolean;
  maxVisibleLanes?: number;
}): CodeBoundaryLayout {
  if (entries.length === 0 || totalLines <= 0) {
    return {
      boundaries: [],
      byLine: new Map<number, CodeBoundaryLineDisplay>()
    };
  }

  const normalized = entries
    .map((entry) => {
      const clamped = clampRange({
        startLine: entry.startLine,
        endLine: entry.endLine,
        totalLines
      });
      if (!clamped) {
        return null;
      }
      return {
        entry,
        ...clamped
      };
    })
    .filter((value): value is { entry: CodeBoundaryEntry; startLine: number; endLine: number } => value !== null)
    .sort((left, right) => compareEntries(left.entry, right.entry));

  if (normalized.length === 0) {
    return {
      boundaries: [],
      byLine: new Map<number, CodeBoundaryLineDisplay>()
    };
  }

  const laneEndByIndex: number[] = [];
  const withLanes: CodeBoundaryWithLane[] = [];

  for (const item of normalized) {
    let lane = 0;
    while (laneEndByIndex[lane] != null && laneEndByIndex[lane]! >= item.startLine) {
      lane += 1;
    }

    laneEndByIndex[lane] = item.endLine;
    withLanes.push({
      entry: item.entry,
      lane,
      startLine: item.startLine,
      endLine: item.endLine,
      color: resolveBoundaryColor({ irNodeId: item.entry.irNodeId, isDark })
    });
  }

  const startsByLine = new Map<number, CodeBoundaryWithLane[]>();
  const endsByLine = new Map<number, CodeBoundaryWithLane[]>();

  for (const boundary of withLanes) {
    const starts = startsByLine.get(boundary.startLine) ?? [];
    starts.push(boundary);
    startsByLine.set(boundary.startLine, starts);

    const ends = endsByLine.get(boundary.endLine) ?? [];
    ends.push(boundary);
    endsByLine.set(boundary.endLine, ends);
  }

  const active: CodeBoundaryWithLane[] = [];
  const byLine = new Map<number, CodeBoundaryLineDisplay>();

  for (let line = 1; line <= totalLines; line += 1) {
    const starting = startsByLine.get(line);
    if (starting && starting.length > 0) {
      active.push(...starting);
      active.sort((left, right) => {
        if (left.lane !== right.lane) {
          return left.lane - right.lane;
        }
        return left.entry.irNodeId.localeCompare(right.entry.irNodeId);
      });
    }

    if (active.length > 0) {
      byLine.set(line, {
        visible: active.slice(0, Math.max(1, maxVisibleLanes)),
        overflowCount: Math.max(0, active.length - Math.max(1, maxVisibleLanes))
      });
    }

    const ending = endsByLine.get(line);
    if (ending && ending.length > 0) {
      for (const boundary of ending) {
        const index = active.findIndex((value) => value === boundary);
        if (index >= 0) {
          active.splice(index, 1);
        }
      }
    }
  }

  return {
    boundaries: withLanes,
    byLine
  };
}
