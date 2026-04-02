import { Box, Container, Typography } from "@mui/material";
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

const variantScenarioOrder = ["1:63230","1:64644","1:66050","1:67464","1:68884"] as const;
const variantScenarioConfig = {
  "1:63230": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "brutto",
      "validationState": "default",
      "expansionState": "collapsed",
      "accordionStateByKey": {
        "accordion_state_collapsed_1_63230_accordion_1": false
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
      "validationState": "default",
      "expansionState": "expanded",
      "accordionStateByKey": {
        "accordion_state_expanded_1_64644_accordion_1": true
      }
    }
  },
  "1:66050": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "netto",
      "validationState": "default",
      "expansionState": "collapsed",
      "accordionStateByKey": {
        "accordion_state_collapsed_1_66050_accordion_1": false
      }
    }
  },
  "1:67464": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "netto",
      "validationState": "default",
      "expansionState": "collapsed",
      "accordionStateByKey": {
        "accordion_state_collapsed_1_67464_accordion_1": false
      }
    }
  },
  "1:68884": {
    "contentScreenId": "1:68884",
    "initialState": {
      "pricingMode": "netto",
      "validationState": "error",
      "expansionState": "collapsed",
      "accordionStateByKey": {
        "accordion_state_collapsed_1_68884_accordion_1": false
      }
    }
  }
} as const;

const matchesRequestedInitialState = (
  variantId: string,
  requestedState: Partial<ID0033NettoBetriebsmittelAlleClusterEingeklapptVariantState> | undefined
): boolean => {
  if (!requestedState) {
    return false;
  }
  const scenario = variantScenarioConfig[variantId as keyof typeof variantScenarioConfig];
  if (!scenario) {
    return false;
  }
  if (requestedState.pricingMode && scenario.initialState.pricingMode !== requestedState.pricingMode) {
    return false;
  }
  if (requestedState.expansionState && scenario.initialState.expansionState !== requestedState.expansionState) {
    return false;
  }
  if (requestedState.validationState && scenario.initialState.validationState !== requestedState.validationState) {
    return false;
  }
  return true;
};

const resolveInitialVariantId = ({
  initialVariantId,
  initialState
}: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptScreenProps>): string => {
  if (initialVariantId && initialVariantId in variantScenarioConfig) {
    return initialVariantId;
  }
  for (const variantId of variantScenarioOrder) {
    if (matchesRequestedInitialState(variantId, initialState)) {
      return variantId;
    }
  }
  return "1:66050";
};

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050ContentBody() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={sharedSxStyle1}>
      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={sharedSxStyle1}>
      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644ContentBody() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={sharedSxStyle1}>
      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644Content() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={sharedSxStyle1}>
      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant3168884ContentBody() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={sharedSxStyle1}>
      {/* @ir:start 1:68884-body Form Body table */}
      <Box data-ir-id="1:68884-body" data-ir-name="Form Body" component="form" sx={{ width: "96.4%", maxWidth: "1288px", minHeight: "2230px", display: "flex", flexDirection: "column" }}>
        {/* @ir:start 1:68884-error Error Text text */}
        <Typography data-ir-id="1:68884-error" data-ir-name="Error Text" sx={{ whiteSpace: "pre-wrap" }}>{"Fehler bei der Validierung"}</Typography>
        {/* @ir:end 1:68884-error */}
      </Box>
      {/* @ir:end 1:68884-body */}
    </Container>
  );
}

function ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant3168884Content() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={sharedSxStyle1}>
      {/* @ir:start 1:68884-body Form Body table */}
      <Box data-ir-id="1:68884-body" data-ir-name="Form Body" component="form" sx={{ width: "96.4%", maxWidth: "1288px", minHeight: "2230px", display: "flex", flexDirection: "column" }}>
        {/* @ir:start 1:68884-error Error Text text */}
        <Typography data-ir-id="1:68884-error" data-ir-name="Error Text" sx={{ whiteSpace: "pre-wrap" }}>{"Fehler bei der Validierung"}</Typography>
        {/* @ir:end 1:68884-error */}
      </Box>
      {/* @ir:end 1:68884-body */}
    </Container>
  );
}

function renderVariantContent(variantId: string) {
  switch (variantId) {
    case "1:63230":
      return <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content />;
    case "1:64644":
      return <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant2164644Content />;
    case "1:66050":
      return <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content />;
    case "1:67464":
      return <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content />;
    case "1:68884":
      return <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant3168884Content />;
    default:
      return <ID0033NettoBetriebsmittelAlleClusterEingeklapptVariant1166050Content />;
  }
}

const sharedSxStyle1 = { position: "relative", width: "100%" };

export default function ID0033NettoBetriebsmittelAlleClusterEingeklapptScreen(props: Readonly<ID0033NettoBetriebsmittelAlleClusterEingeklapptScreenProps>) {
  const resolvedVariantId = resolveInitialVariantId(props);
  const resolvedScenario = variantScenarioConfig[resolvedVariantId as keyof typeof variantScenarioConfig] ??
    variantScenarioConfig["1:66050" as keyof typeof variantScenarioConfig];
  const screenContent = renderVariantContent(resolvedVariantId);
  return (
    <AppShell1 textOverrides={resolvedScenario.shellTextOverrides}>
      {screenContent}
    </AppShell1>
  );
}
