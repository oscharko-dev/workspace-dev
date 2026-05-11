import { Alert, Container, Typography } from "@mui/material";
import AppShell1 from "../components/AppShell1";

interface ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantState {
  pricingMode?: "netto" | "brutto";
  expansionState?: "collapsed" | "expanded";
  validationState?: "default" | "error";
}

export interface ID0033NettoBetriebsmittelAlleClusterEingeklapptScreenProps {
  initialVariantId?: string;
  initialState?: Partial<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantState>;
}

interface ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantScenario {
  contentScreenId: string;
  initialState: Partial<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantState>;
  shellTextOverrides?: Record<string, string>;
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
  screenLevelErrorEvidence?: ReadonlyArray<{
    message: string;
    severity: "error";
    sourceNodeId?: string;
  }>;
}

const variantScenarioConfig = {
  "1:63230": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "brutto",
      "expansionState": "collapsed",
      "validationState": "default",
      "accordionStateByKey": {
        "accordion_state_collapsed": false
      }
    },
    "shellTextOverrides": {
      "1:66050-mode": "Brutto"
    }
  },
  "1:64644": {
    "contentScreenId": "1:64644",
    "initialState": {
      "pricingMode": "netto",
      "expansionState": "expanded",
      "validationState": "default",
      "accordionStateByKey": {
        "accordion_state_expanded": true
      }
    }
  },
  "1:66050": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "netto",
      "expansionState": "collapsed",
      "validationState": "default",
      "accordionStateByKey": {
        "accordion_state_collapsed": false
      }
    }
  },
  "1:67464": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "netto",
      "expansionState": "collapsed",
      "validationState": "default",
      "accordionStateByKey": {
        "accordion_state_collapsed": false
      }
    }
  },
  "1:68884": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "netto",
      "expansionState": "collapsed",
      "validationState": "error",
      "accordionStateByKey": {
        "accordion_state_collapsed": false
      }
    },
    "screenLevelErrorEvidence": [
      {
        "message": "Fehler bei der Validierung",
        "severity": "error",
        "sourceNodeId": "1:68884-error"
      }
    ]
  }
} as const satisfies Record<string, ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantScenario>;
type ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantId = keyof typeof variantScenarioConfig;
const defaultVariantId: ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantId = "1:66050";
const variantScenarioOrder = ["1:63230","1:64644","1:66050","1:67464","1:68884"] as const satisfies ReadonlyArray<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantId>;

const hasVariantScenario = (variantId: string): variantId is ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantId => {
  return Object.prototype.hasOwnProperty.call(variantScenarioConfig, variantId);
};

const matchesRequestedInitialState = (
  scenario: ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantScenario,
  requestedState: Partial<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantState> | undefined
): boolean => {
  if (requestedState === undefined) {
    return false;
  }
  if (requestedState.pricingMode !== undefined && scenario.initialState.pricingMode !== requestedState.pricingMode) {
    return false;
  }
  if (requestedState.expansionState !== undefined && scenario.initialState.expansionState !== requestedState.expansionState) {
    return false;
  }
  if (requestedState.validationState !== undefined && scenario.initialState.validationState !== requestedState.validationState) {
    return false;
  }
  return true;
};

const resolveInitialVariantId = ({
  initialVariantId,
  initialState
}: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptScreenProps>): ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantId => {
  if (initialVariantId !== undefined && hasVariantScenario(initialVariantId)) {
    return initialVariantId;
  }
  for (const variantId of variantScenarioOrder) {
    if (matchesRequestedInitialState(variantScenarioConfig[variantId], initialState)) {
      return variantId;
    }
  }
  return defaultVariantId;
};

interface ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050ContentProps {
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
  screenLevelErrorEvidence?: ReadonlyArray<{
    message: string;
    severity: "error";
    sourceNodeId?: string;
  }>;
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050ContentBody(props: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050ContentProps>) {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={{ position: "relative", width: "100%" }}>
      {props.screenLevelErrorEvidence?.map((screenLevelError) => (
        <Alert severity={screenLevelError.severity}>{screenLevelError.message}</Alert>
      ))}
      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content(props: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050ContentProps>) {
  return (
      <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050ContentBody
        screenLevelErrorEvidence={props.screenLevelErrorEvidence}
      />
  );
}

interface ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644ContentProps {
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
  screenLevelErrorEvidence?: ReadonlyArray<{
    message: string;
    severity: "error";
    sourceNodeId?: string;
  }>;
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644ContentBody(props: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644ContentProps>) {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={{ position: "relative", width: "100%" }}>
      {props.screenLevelErrorEvidence?.map((screenLevelError) => (
        <Alert severity={screenLevelError.severity}>{screenLevelError.message}</Alert>
      ))}
      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644Content(props: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644ContentProps>) {
  return (
      <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644ContentBody
        screenLevelErrorEvidence={props.screenLevelErrorEvidence}
      />
  );
}

function renderVariantContent(
  variantId: ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantId,
  scenario: ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantScenario
) {
  switch (variantId) {
    case "1:63230":
      return (
        <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:64644":
      return (
        <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:66050":
      return (
        <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:67464":
      return (
        <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:68884":
      return (
        <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    default:
      return (
        <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
  }
}

export default function ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen(props: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptScreenProps>) {
  const resolvedVariantId = resolveInitialVariantId(props);
  const resolvedScenario = variantScenarioConfig[resolvedVariantId];
  const screenContent = renderVariantContent(resolvedVariantId, resolvedScenario);
  return (
    <AppShell1 textOverrides={resolvedScenario.shellTextOverrides}>
      {screenContent}
    </AppShell1>
  );
}
