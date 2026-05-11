/**
 * Shared visitor contracts for deterministic IR-node transformation phases.
 *
 * The contract is intentionally minimal:
 * - enter hooks run in declaration order
 * - child traversal runs exactly once between enter/exit phases
 * - exit hooks run in reverse declaration order
 *
 * This keeps phase ordering explicit and stable across refactors.
 */

export interface IrVisitContext<TNode, TState> {
  node: TNode;
  depth: number;
  state: TState;
}

export interface IrVisitor<TNode, TState> {
  name: string;
  enter?: (context: IrVisitContext<TNode, TState>) => void;
  exit?: (context: IrVisitContext<TNode, TState>) => void;
}

export interface VisitIrNodeInput<TNode, TState> {
  node: TNode;
  depth: number;
  state: TState;
  visitors: readonly IrVisitor<TNode, TState>[];
  traverseChildren: () => void;
}

export const runIrVisitorEnterPhase = <TNode, TState>({
  visitors,
  context
}: {
  visitors: readonly IrVisitor<TNode, TState>[];
  context: IrVisitContext<TNode, TState>;
}): void => {
  for (const visitor of visitors) {
    visitor.enter?.(context);
  }
};

export const runIrVisitorExitPhase = <TNode, TState>({
  visitors,
  context
}: {
  visitors: readonly IrVisitor<TNode, TState>[];
  context: IrVisitContext<TNode, TState>;
}): void => {
  for (let index = visitors.length - 1; index >= 0; index -= 1) {
    visitors[index]?.exit?.(context);
  }
};

export const visitIrNode = <TNode, TState>({
  node,
  depth,
  state,
  visitors,
  traverseChildren
}: VisitIrNodeInput<TNode, TState>): void => {
  const context: IrVisitContext<TNode, TState> = {
    node,
    depth,
    state
  };

  runIrVisitorEnterPhase({
    visitors,
    context
  });
  traverseChildren();
  runIrVisitorExitPhase({
    visitors,
    context
  });
};
