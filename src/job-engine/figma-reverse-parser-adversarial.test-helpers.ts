import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FigmaFileResponse } from "./types.js";

export interface AdversarialTailwindFixtureSpec {
  name:
    | "unusual-class-names"
    | "malformed-token-references"
    | "deep-node-tree"
    | "pathological-style-stacks";
  rawIdentifier: string;
  exactMappingNodeId?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_DIR = path.join(
  __dirname,
  "..",
  "parity",
  "fixtures",
  "adversarial-tailwind",
);

export const ADVERSARIAL_TAILWIND_FIXTURES: readonly AdversarialTailwindFixtureSpec[] =
  [
    {
      name: "unusual-class-names",
      rawIdentifier: "按钮\u200dمرحبا\u200f",
      exactMappingNodeId: "component-unusual",
    },
    {
      name: "malformed-token-references",
      rawIdentifier: "{token.theme.primary",
      exactMappingNodeId: "component-token",
    },
    {
      name: "deep-node-tree",
      rawIdentifier: "deep-leaf-\u200braw-identifier",
    },
    {
      name: "pathological-style-stacks",
      rawIdentifier: "fill-conflict-\u200dtrace",
    },
  ] as const;

export const loadAdversarialTailwindFixture = async (
  fixtureName: AdversarialTailwindFixtureSpec["name"],
): Promise<FigmaFileResponse> => {
  const raw = await readFile(path.join(FIXTURE_DIR, `${fixtureName}.json`), "utf8");
  return JSON.parse(raw) as FigmaFileResponse;
};

export const cloneFixture = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

export const measureExecution = async <T>(
  run: () => Promise<T> | T,
): Promise<{ elapsedMs: number; result: T }> => {
  const start = performance.now();
  const result = await run();
  return { elapsedMs: performance.now() - start, result };
};

export const assertCompletesWithinBudget = (elapsedMs: number): void => {
  assert.ok(
    elapsedMs < 200,
    `Expected adversarial parser path to complete within 200ms, saw ${elapsedMs.toFixed(2)}ms.`,
  );
};

export const serializeWithStableMaps = (value: unknown): string =>
  JSON.stringify(value, (_key, entry): unknown => {
    if (!(entry instanceof Map)) {
      return entry;
    }
    const pairs: Array<[string, unknown]> = [];
    for (const [key, mapValue] of entry.entries()) {
      if (typeof key === "string") {
        pairs.push([key, mapValue]);
      }
    }
    return pairs.sort(([left], [right]) => left.localeCompare(right));
  });

const findNodeById = (
  root: unknown,
  nodeId: string,
): Record<string, unknown> | undefined => {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return undefined;
  }

  const queue: Array<Record<string, unknown>> = [root as Record<string, unknown>];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current.id === nodeId) {
      return current;
    }
    const children = current.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object" && !Array.isArray(child)) {
          queue.push(child as Record<string, unknown>);
        }
      }
    }
  }

  return undefined;
};

export const createExactCodeConnectFetch = ({
  rawFile,
  fallbackComponentName,
}: {
  rawFile: FigmaFileResponse;
  fallbackComponentName: string;
}): typeof fetch => {
  return async (input, init) => {
    const request = new Request(input, init);
    const body = (await request.json()) as {
      params?: { name?: string };
    };
    const toolName = body.params?.name;

    if (toolName === "get_code_connect_map") {
      const componentNode =
        findNodeById(rawFile.document, "component-unusual") ??
        findNodeById(rawFile.document, "component-token");
      if (componentNode && typeof componentNode.id === "string") {
        return new Response(
          JSON.stringify({
            result: {
              [componentNode.id]: {
                codeConnectSrc: `src/components/${fallbackComponentName}.tsx`,
                codeConnectName: fallbackComponentName,
                label: "React",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (toolName === "search_design_system") {
      return new Response(
        JSON.stringify({
          result: { components: [], styles: [], variables: [] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (toolName === "get_code_connect_suggestions") {
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
};

export const createHybridLoaderFetch = ({
  rootNodeName,
}: {
  rootNodeName: string;
}): typeof fetch => {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.figma.com") {
      return new Response(JSON.stringify({ document: { children: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const body = (await request.json()) as {
      params?: { name?: string; arguments?: { nodeId?: string } };
    };
    const toolName = body.params?.name;
    if (toolName === "get_metadata") {
      return new Response(
        JSON.stringify({
          result: {
            xml: `<FRAME id="screen-root" name="${rootNodeName}"><TEXT id="headline-safe" name="Headline" /></FRAME>`,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (toolName === "get_design_context") {
      return new Response(
        JSON.stringify({
          result: {
            code: "export default function SafeScreen() { return null; }",
            assets: {},
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (toolName === "get_screenshot") {
      return new Response(
        JSON.stringify({
          result: { url: "https://cdn.figma.com/screenshots/safe-screen.png" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (toolName === "get_variable_defs") {
      return new Response(JSON.stringify({ result: { variables: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (toolName === "search_design_system") {
      return new Response(
        JSON.stringify({
          result: { components: [], styles: [], variables: [] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (toolName === "get_code_connect_map") {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (toolName === "get_code_connect_suggestions") {
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected hybrid test tool '${String(toolName)}'.`);
  };
};

export const createDeepTreeFixture = ({
  depth,
  rawIdentifier,
}: {
  depth: number;
  rawIdentifier: string;
}): FigmaFileResponse => {
  const nestedLeaf = {
    id: `deep-leaf-${depth}`,
    type: "FRAME",
    name: "Deep Leaf",
    visible: false,
    children: [
      {
        id: "deep-hidden-text",
        type: "TEXT",
        name: "Hidden raw trace",
        characters: rawIdentifier,
      },
    ],
  };

  let cursor: Record<string, unknown> = nestedLeaf;
  for (let level = depth - 1; level >= 0; level -= 1) {
    cursor = {
      id: `deep-frame-${level}`,
      type: "FRAME",
      name: `Depth ${level}`,
      children: [cursor],
    };
  }

  return {
    name: "Generated deep adversarial tree",
    lastModified: "2026-05-05T00:00:00.000Z",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Page 1",
          children: [
            {
              id: "screen-root",
              type: "FRAME",
              name: "Deep Screen",
              children: [cursor],
            },
          ],
        },
      ],
    },
  };
};

export const expandPathologicalStyleFixture = (
  file: FigmaFileResponse,
): FigmaFileResponse => {
  const next = cloneFixture(file);
  const document = next.document as Record<string, unknown>;
  const canvas = Array.isArray(document.children)
    ? (document.children[0] as Record<string, unknown> | undefined)
    : undefined;
  const screen = Array.isArray(canvas?.children)
    ? (canvas.children[0] as Record<string, unknown> | undefined)
    : undefined;
  const stressNode = Array.isArray(screen?.children)
    ? (screen.children[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!stressNode) {
    return next;
  }

  const recordArray = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];

  const fills = Array.isArray(stressNode.fills)
    ? recordArray(stressNode.fills)
    : [];
  while (fills.length < 1024) {
    fills.push({
      type: fills.length % 2 === 0 ? "SOLID" : "GRADIENT_LINEAR",
      color: {
        r: ((fills.length % 7) + 1) / 10,
        g: ((fills.length % 11) + 1) / 12,
        b: ((fills.length % 13) + 1) / 14,
        a: 1,
      },
      opacity: 1,
      gradientStops: [
        {
          position: 0,
          color: { r: 0.2, g: 0.2, b: 0.3, a: 1 },
        },
        {
          position: 1,
          color: { r: 0.8, g: 0.4, b: 0.2, a: 1 },
        },
      ],
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
  }
  stressNode.fills = fills;

  const children = Array.isArray(stressNode.children)
    ? recordArray(stressNode.children)
    : [];
  const baseText = {
    id: "style-stress-seed",
    type: "TEXT",
    name: "Stress seed",
    characters: "font stress",
    style: {
      fontSize: 14,
      fontWeight: 400,
      fontFamily: "Inter",
      lineHeightPx: 20,
      textAlignHorizontal: "LEFT",
    },
  };
  while (children.length < 1024) {
    children.push({
      ...baseText,
      id: `style-stress-text-${children.length}`,
      name: `Stress text ${children.length}`,
      style: {
        ...baseText.style,
        fontWeight: 100 + (children.length % 900),
      },
    });
  }
  stressNode.children = children;

  return next;
};
