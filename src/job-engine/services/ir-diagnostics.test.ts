import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeScreenCandidateRejections,
  toFigmaNodeUrl,
  toMcpCoverageDiagnostics,
  toSortedReasonCounts,
} from "./ir-diagnostics.js";
import type { FigmaFileResponse } from "../types.js";

test("analyzeScreenCandidateRejections classifies rejected screens and counts reasons", () => {
  const sourceFile: FigmaFileResponse = {
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "page-hidden",
          name: "Hidden Page",
          type: "CANVAS",
          visible: false,
        },
        {
          id: "page-visible",
          name: "Visible Page",
          type: "CANVAS",
          children: [
            {
              id: "screen-root",
              name: "Screen Root",
              type: "FRAME",
              children: [],
            },
            {
              id: "hidden-frame",
              name: "Hidden Frame",
              type: "FRAME",
              visible: false,
            },
            {
              id: "loose-text",
              name: "Loose Text",
              type: "TEXT",
            },
            {
              id: "outer-section",
              name: "Outer Section",
              type: "SECTION",
              children: [
                {
                  id: "inner-text",
                  name: "Inner Text",
                  type: "TEXT",
                },
                {
                  id: "inner-section",
                  name: "Inner Section",
                  type: "SECTION",
                  children: [
                    {
                      id: "deep-text",
                      name: "Deep Text",
                      type: "TEXT",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const { rejectedCandidates, rootCandidateCount } = analyzeScreenCandidateRejections({
    sourceFile,
  });
  const reasonCounts = toSortedReasonCounts({ rejectedCandidates });

  assert.equal(rootCandidateCount, 1);
  assert.equal(rejectedCandidates.length, 7);
  assert.deepEqual(reasonCounts, {
    "hidden-node": 1,
    "hidden-page": 1,
    "non-screen-root": 1,
    "section-without-screen-like-children": 2,
    "unsupported-node-type": 2,
  });
  assert.deepEqual(Object.keys(reasonCounts), [
    "hidden-node",
    "hidden-page",
    "non-screen-root",
    "section-without-screen-like-children",
    "unsupported-node-type",
  ]);
});

test("toFigmaNodeUrl formats node URLs with encoded keys and dashed node IDs", () => {
  assert.equal(
    toFigmaNodeUrl({
      fileKey: "  board/key  ",
      nodeId: "  1:2:3  ",
    }),
    "https://www.figma.com/design/board%2Fkey?node-id=1-2-3",
  );
  assert.equal(
    toFigmaNodeUrl({
      fileKey: "   ",
      nodeId: "1:2",
    }),
    undefined,
  );
});

test("toMcpCoverageDiagnostics keeps stage metadata and source-specific suggestions", () => {
  assert.deepEqual(
    toMcpCoverageDiagnostics({
      stage: "ir.derive",
      diagnostics: [
        {
          code: "MCP_LOADER_MISSING",
          message: "Loader returned partial coverage.",
          severity: "warning",
          source: "loader",
        },
        {
          code: "MCP_CODE_CONNECT_GAP",
          message: "Code connect coverage is incomplete.",
          severity: "info",
          source: "code_connect",
        },
      ],
    }),
    [
      {
        code: "MCP_LOADER_MISSING",
        message: "Loader returned partial coverage.",
        suggestion:
          "Configure a hybrid MCP enrichment loader or use pure REST mode if no MCP data is available.",
        stage: "ir.derive",
        severity: "warning",
      },
      {
        code: "MCP_CODE_CONNECT_GAP",
        message: "Code connect coverage is incomplete.",
        suggestion:
          "Check MCP code connect availability and data coverage for this board.",
        stage: "ir.derive",
        severity: "info",
      },
    ],
  );
});
