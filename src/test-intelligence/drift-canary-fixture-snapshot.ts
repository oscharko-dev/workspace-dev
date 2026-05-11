import type {
  FigmaRestFileSnapshot,
  FigmaRestNode,
} from "./figma-rest-adapter.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const DRIFT_CANARY_FIXTURE_INTENT_OVERRIDE_KEY =
  "__workspaceDevDriftCanaryIntentOverride";

type DriftCanaryFixtureSnapshot = FigmaRestFileSnapshot & {
  [DRIFT_CANARY_FIXTURE_INTENT_OVERRIDE_KEY]?: IntentDerivationFigmaInput;
};

const buildSyntheticScreenNode = (
  screen: IntentDerivationFigmaInput["screens"][number],
): FigmaRestNode => {
  const children: FigmaRestNode[] = screen.nodes.map((node, index) => {
    const y = 48 + index * 88;
    const bbox = {
      x: 40,
      y,
      width: 960,
      height: node.nodeType === "BUTTON" ? 56 : 40,
    };
    const text = node.text?.trim() || node.nodeName;
    switch (node.nodeType) {
      case "BUTTON":
        return {
          id: node.nodeId,
          name: `${text} button`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "TEXT_INPUT":
        return {
          id: node.nodeId,
          name: `${text} input`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "RADIO_OPTION":
        return {
          id: node.nodeId,
          name: `${text} radio option`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "SELECT_FIELD":
        return {
          id: node.nodeId,
          name: `${text} select field`,
          type: "INSTANCE",
          characters: text,
          absoluteBoundingBox: bbox,
          children: [],
        };
      case "RESULT_DISPLAY":
        return {
          id: node.nodeId,
          name: `${text} result`,
          type: "TEXT",
          characters: text,
          absoluteBoundingBox: bbox,
        };
      case "INFORMATIVE_LABEL":
        return {
          id: node.nodeId,
          name: `${text} label`,
          type: "TEXT",
          characters: text,
          absoluteBoundingBox: bbox,
        };
      default:
        return {
          id: node.nodeId,
          name: node.nodeName,
          type: "TEXT",
          characters: text,
          absoluteBoundingBox: bbox,
        };
    }
  });
  return {
    id: screen.screenId,
    name: screen.screenName,
    type: "FRAME",
    absoluteBoundingBox: {
      x: 0,
      y: 0,
      width: 1080,
      height: Math.max(640, 120 + children.length * 88),
    },
    children,
  };
};

export const buildDriftCanaryFixtureSnapshot = (input: {
  fixtureId: string;
  fixture: IntentDerivationFigmaInput;
  name: string;
}): FigmaRestFileSnapshot =>
  ({
    name: input.name,
    fileKey: input.fixtureId,
    document: {
      id: input.fixtureId,
      name: input.name,
      type: "DOCUMENT",
      children: input.fixture.screens.map(buildSyntheticScreenNode),
    },
    [DRIFT_CANARY_FIXTURE_INTENT_OVERRIDE_KEY]: input.fixture,
  }) as DriftCanaryFixtureSnapshot;

export const readDriftCanaryFixtureIntentOverride = (
  input: FigmaRestFileSnapshot,
): IntentDerivationFigmaInput | undefined =>
  (input as DriftCanaryFixtureSnapshot)[DRIFT_CANARY_FIXTURE_INTENT_OVERRIDE_KEY];
