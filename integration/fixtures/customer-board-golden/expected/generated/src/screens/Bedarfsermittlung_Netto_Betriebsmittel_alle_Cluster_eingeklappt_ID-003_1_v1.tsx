import { useState } from "react";
import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import type { SelectChangeEvent } from "@mui/material/Select";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentFormContextProvider, useBedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentFormContext } from "../context/BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentFormContext";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Avatar, Box, Button, Card, CardContent, Chip, Container, Divider, FormControl, FormHelperText, IconButton, InputLabel, MenuItem, Radio, Select, Stack, SvgIcon, TextField } from "@mui/material";
import AppShell1 from "../components/AppShell1";

interface BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantState {
  pricingMode?: "netto" | "brutto";
  expansionState?: "collapsed" | "expanded";
  validationState?: "default" | "error";
}

export interface BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1ScreenProps {
  initialVariantId?: string;
  initialState?: Partial<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantState>;
}

interface BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantScenario {
  contentScreenId: string;
  initialState: Partial<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantState>;
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
    "contentScreenId": "1:67464",
    "initialState": {}
  },
  "1:64644": {
    "contentScreenId": "1:67464",
    "initialState": {}
  },
  "1:66050": {
    "contentScreenId": "1:66050",
    "initialState": {
      "pricingMode": "brutto",
      "expansionState": "expanded"
    }
  },
  "1:67464": {
    "contentScreenId": "1:67464",
    "initialState": {}
  },
  "1:68884": {
    "contentScreenId": "1:67464",
    "initialState": {}
  }
} as const satisfies Record<string, BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantScenario>;
type BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantId = keyof typeof variantScenarioConfig;
const defaultVariantId: BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantId = "1:67464";
const variantScenarioOrder = ["1:63230","1:64644","1:66050","1:67464","1:68884"] as const satisfies ReadonlyArray<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantId>;

const hasVariantScenario = (variantId: string): variantId is BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantId => {
  return Object.prototype.hasOwnProperty.call(variantScenarioConfig, variantId);
};

const matchesRequestedInitialState = (
  scenario: BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantScenario,
  requestedState: Partial<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantState> | undefined
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
}: Readonly<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1ScreenProps>): BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantId => {
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

interface BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464ContentProps {
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
  screenLevelErrorEvidence?: ReadonlyArray<{
    message: string;
    severity: "error";
    sourceNodeId?: string;
  }>;
}

function BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464ContentBody(props: Readonly<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464ContentProps>) {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={{ position: "relative", width: "100%" }}>
      {props.screenLevelErrorEvidence?.map((screenLevelError) => (
        <Alert severity={screenLevelError.severity}>{screenLevelError.message}</Alert>
      ))}
      {/* @ir:start 1:67552 SeitenContent stack */}
      <Stack data-ir-id="1:67552" data-ir-name="SeitenContent" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={{ width: "71.9%", maxWidth: "960px", minHeight: "1832px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* @ir:start 1:67555 <Stack> stack */}
        <Box data-ir-id="1:67555" data-ir-name="<Stack>" aria-hidden="true" sx={{ width: "960px", height: "1764px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 3.2 }} />
        {/* @ir:end 1:67555 */}
        {/* @ir:start 1:68873 <Stack> ButtonCombination stack */}
        <Box data-ir-id="1:68873" data-ir-name="<Stack> ButtonCombination" aria-hidden="true" sx={{ width: "960px", height: "68px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", pt: 2 }} />
        {/* @ir:end 1:68873 */}
      </Stack>
      {/* @ir:end 1:67552 */}
    </Container>
  );
}

function BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464Content(props: Readonly<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464ContentProps>) {
  return (
      <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464ContentBody
        screenLevelErrorEvidence={props.screenLevelErrorEvidence}
      />
  );
}

interface BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentProps {
  initialVisualErrorsOverride?: Record<string, string>;
  validationMessagesOverride?: Record<string, string>;
  screenLevelErrorEvidence?: ReadonlyArray<{
    message: string;
    severity: "error";
    sourceNodeId?: string;
  }>;
}

function BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentBody(props: Readonly<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentProps>) {
  const { selectOptions, control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitting, isSubmitted } = useBedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentFormContext();

  const [accordionState, setAccordionState] = useState<Record<string, boolean>>({
    "_accordion__1_67438": true,
    "_accordion__1_67440": true,
    "_accordion__1_67442": true,
    "_accordion__1_67444": true,
    "_accordion__1_67446": true
  });

  const updateAccordionState = (accordionKey: string, expanded: boolean): void => {
    setAccordionState((previous) => ({ ...previous, [accordionKey]: expanded }));
  };
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" component="form" onSubmit={((event) => { void handleSubmit(onSubmit)(event); })} noValidate sx={{ position: "relative", width: "100%" }}>
      {props.screenLevelErrorEvidence?.map((screenLevelError) => (
        <Alert severity={screenLevelError.severity}>{screenLevelError.message}</Alert>
      ))}
      {/* @ir:start 1:66138 SeitenContent stack */}
      <Stack data-ir-id="1:66138" data-ir-name="SeitenContent" component="main" direction="column" spacing={0} role="main" sx={{ width: "71.9%", maxWidth: "960px", minHeight: "2076px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* @ir:start 1:66141 <Stack> stack */}
        <Stack data-ir-id="1:66141" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "100%", maxWidth: "960px", minHeight: "2008px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 3.2 }}>
          {/* @ir:start 1:66143 <Stack> stack */}
          <Stack data-ir-id="1:66143" data-ir-name="<Stack>" direction="column" spacing={0} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "86px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {/* @ir:start I1:66143;4919:305782 <Divider> divider */}
            <Divider data-ir-id="I1:66143;4919:305782" data-ir-name="<Divider>" aria-hidden="true" sx={sharedSxStyle1} />
            {/* @ir:end I1:66143;4919:305782 */}
            {/* @ir:start I1:66143;4919:306280 <Stack2>(Nested) stack */}
            <Stack data-ir-id="I1:66143;4919:306280" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.2} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "84px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1.2, py: 1.6, px: 2 }}>
              {/* @ir:start I1:66143;4919:306280;9445:27854 <Avatar> avatar */}
              <Avatar data-ir-id="I1:66143;4919:306280;9445:27854" data-ir-name="<Avatar>" sx={{ width: "5%", maxWidth: "48px", minHeight: "48px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", bgcolor: "#f5f5f5", borderRadius: 8 }}></Avatar>
              {/* @ir:end I1:66143;4919:306280;9445:27854 */}
              {/* @ir:start I1:66143;4919:306280;9445:27870 <Stack3>(Nested) stack */}
              <Stack data-ir-id="I1:66143;4919:306280;9445:27870" data-ir-name="<Stack3>(Nested)" direction="column" spacing={0.4} aria-hidden="true" sx={{ width: "89.6%", maxWidth: "860px", minHeight: "48px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.4 }}>
                {/* @ir:start I1:66143;4919:306280;9445:27870;9445:28813 <Stack4>(Nested) stack */}
                <Stack data-ir-id="I1:66143;4919:306280;9445:27870;9445:28813" data-ir-name="<Stack4>(Nested)" direction="row" spacing={0.4} aria-hidden="true" sx={{ width: "100%", maxWidth: "860px", minHeight: "20px", display: "flex", flexDirection: "row", alignItems: "center", gap: 0.4 }}>
                  {/* @ir:start I1:66143;4919:306280;9445:27870;9445:28813;9445:29980 <Icon> container */}
                  <SvgIcon data-ir-id="I1:66143;4919:306280;9445:27870;9445:28813;9445:29980" data-ir-name="<Icon>" aria-hidden="true" sx={{ height: "16px", color: "#565656", width: "1.9%", maxWidth: "16px", minHeight: "16px", flexDirection: "row", display: "flex", alignItems: "center", justifyContent: "center" }} viewBox={"0 0 16 16"}><path d={"M13.138 6.862L9.138 2.862C9.0765 2.79833 9.00294 2.74754 8.9216 2.7126C8.84027 2.67766 8.75279 2.65927 8.66427 2.6585C8.57575 2.65773 8.48796 2.6746 8.40603 2.70812C8.3241 2.74164 8.24967 2.79114 8.18707 2.85374C8.12447 2.91633 8.07497 2.99077 8.04145 3.0727C8.00793 3.15463 7.99106 3.24241 7.99183 3.33093C7.9926 3.41945 8.01099 3.50693 8.04593 3.58827C8.08087 3.66961 8.13166 3.74317 8.19533 3.80467L11.0573 6.66667L1.33333 6.66667L1.33333 0.666667C1.33333 0.489856 1.2631 0.320286 1.13807 0.195262C1.01305 0.0702379 0.843478 5.92119e-16 0.666667 0C0.489856 5.92119e-16 0.320286 0.0702379 0.195262 0.195262C0.0702379 0.320286 5.92119e-16 0.489856 0 0.666667L0 7.33333C2.96059e-16 7.51014 0.0702379 7.67971 0.195262 7.80474C0.320286 7.92976 0.489856 8 0.666667 8L11.0573 8L8.19533 10.862C8.13166 10.9235 8.08087 10.9971 8.04593 11.0784C8.01099 11.1597 7.9926 11.2472 7.99183 11.3357C7.99106 11.4243 8.00793 11.512 8.04145 11.594C8.07497 11.6759 8.12447 11.7503 8.18707 11.8129C8.24967 11.8755 8.3241 11.925 8.40603 11.9585C8.48796 11.9921 8.57575 12.0089 8.66427 12.0082C8.75279 12.0074 8.84027 11.989 8.9216 11.9541C9.00294 11.9191 9.0765 11.8683 9.138 11.8047L13.138 7.80467C13.1999 7.74279 13.2491 7.66931 13.2826 7.58844C13.3161 7.50757 13.3334 7.42088 13.3334 7.33333C13.3334 7.24579 13.3161 7.1591 13.2826 7.07823C13.2491 6.99735 13.1999 6.92388 13.138 6.862L13.138 6.862Z"} /></SvgIcon>
                  {/* @ir:end I1:66143;4919:306280;9445:27870;9445:28813;9445:29980 */}
                </Stack>
                {/* @ir:end I1:66143;4919:306280;9445:27870;9445:28813 */}
              </Stack>
              {/* @ir:end I1:66143;4919:306280;9445:27870 */}
            </Stack>
            {/* @ir:end I1:66143;4919:306280 */}
            {/* @ir:start I1:66143;4919:306286 <Divider> divider */}
            <Divider data-ir-id="I1:66143;4919:306286" data-ir-name="<Divider>" aria-hidden="true" sx={sharedSxStyle1} />
            {/* @ir:end I1:66143;4919:306286 */}
          </Stack>
          {/* @ir:end 1:66143 */}
          {/* @ir:start 1:66145 <Stack> stack */}
          <Stack data-ir-id="1:66145" data-ir-name="<Stack>" direction="column" spacing={1.2} sx={{ width: "100%", maxWidth: "960px", minHeight: "214px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1.2, py: 3.2 }}>
            {/* @ir:start 1:66177 <Stack> stack */}
            <Stack data-ir-id="1:66177" data-ir-name="<Stack>" direction="row" spacing={1.2} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "24px", display: "flex", flexDirection: "row", alignItems: "center", gap: 1.2, px: 2 }}>
              {/* @ir:start I1:66177;5213:6541 <Icon> container */}
              <SvgIcon data-ir-id="I1:66177;5213:6541" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle2} viewBox={"0 0 24 24"}><path d={"M13.3846 12.0002C13.8455 12.0105 14.2871 12.1875 14.6277 12.4982C14.9684 12.8091 15.1848 13.2334 15.2371 13.6916L15.99 18.8557C16.0108 18.9976 16.0009 19.1427 15.9607 19.2805C15.9205 19.4182 15.8515 19.5459 15.7576 19.6545C15.6638 19.763 15.5473 19.8497 15.4168 19.9094C15.2863 19.969 15.1443 20.0002 15.0008 20.0002L1.00079 20.0002C0.857161 20.0003 0.714424 19.9691 0.583793 19.9094C0.453341 19.8497 0.336806 19.763 0.242973 19.6545C0.149135 19.5459 0.08006 19.4182 0.039848 19.2805C-0.000313846 19.1427 -0.0101904 18.9976 0.0105511 18.8557L0.763481 13.6916C0.815817 13.2334 1.03219 12.8091 1.37286 12.4982C1.71343 12.1875 2.15509 12.0106 2.61602 12.0002L13.3846 12.0002ZM2.15704 18.0002L13.8445 18.0002L13.2606 14.0002L2.74395 14.0002L2.15704 18.0002ZM7.0252 0.095893C7.99504 -0.0970194 9.00029 0.00267759 9.91387 0.381049C10.8274 0.759429 11.6086 1.39981 12.158 2.22187C12.7074 3.04411 13.0008 4.01128 13.0008 5.00019C12.9992 6.32578 12.4723 7.59703 11.535 8.53437C10.5976 9.47171 9.32638 9.9986 8.00079 10.0002C7.01188 10.0002 6.04471 9.70682 5.22247 9.15742C4.4004 8.60802 3.76002 7.82676 3.38164 6.91328C3.00327 5.9997 2.90358 4.99444 3.09649 4.0246C3.28942 3.05472 3.76638 2.16428 4.46563 1.46503C5.16488 0.765786 6.05532 0.288827 7.0252 0.095893ZM8.00079 2.00019C7.40744 2.00019 6.82714 2.17641 6.33379 2.50605C5.84071 2.8356 5.45634 3.30386 5.2293 3.85175C5.00228 4.39983 4.94273 5.0033 5.0584 5.58515C5.17416 6.16709 5.46014 6.70173 5.87969 7.12128C6.29925 7.54084 6.83388 7.82682 7.41582 7.94257C7.99767 8.05825 8.60114 7.9987 9.14922 7.77167C9.69712 7.54464 10.1654 7.16026 10.4949 6.66718C10.8246 6.17383 11.0008 5.59353 11.0008 5.00019C11.0008 4.20454 10.6845 3.4417 10.1219 2.8791C9.55927 2.31649 8.79643 2.00019 8.00079 2.00019Z"} /><path d={"M5 10C4.0111 10 3.0444 9.70676 2.22215 9.15735C1.39991 8.60794 0.759043 7.82705 0.380605 6.91342C0.00216642 5.99979 -0.0968503 4.99446 0.0960759 4.02455C0.289002 3.05465 0.765206 2.16373 1.46447 1.46447C2.16373 0.765206 3.05465 0.289002 4.02455 0.0960759C4.99446 -0.0968503 5.99979 0.00216642 6.91342 0.380605C7.82705 0.759043 8.60794 1.39991 9.15735 2.22215C9.70676 3.0444 10 4.0111 10 5C9.99841 6.3256 9.47112 7.59644 8.53378 8.53378C7.59644 9.47112 6.3256 9.99841 5 10L5 10ZM5 2C4.40666 2 3.82664 2.17595 3.33329 2.50559C2.83994 2.83524 2.45543 3.30377 2.22836 3.85195C2.0013 4.40013 1.94189 5.00333 2.05765 5.58527C2.1734 6.16722 2.45912 6.70177 2.87868 7.12132C3.29824 7.54088 3.83279 7.8266 4.41473 7.94236C4.99667 8.05811 5.59987 7.9987 6.14805 7.77164C6.69623 7.54458 7.16477 7.16006 7.49441 6.66671C7.82406 6.17337 8 5.59335 8 5C8 4.20435 7.68393 3.44129 7.12132 2.87868C6.55871 2.31607 5.79565 2 5 2L5 2Z"} /><path d={"M15.0006 8L1.00057 8C0.856943 8.00008 0.714986 7.96922 0.584356 7.90953C0.453725 7.84983 0.337486 7.7627 0.243548 7.65405C0.14961 7.54541 0.0801783 7.4178 0.0399755 7.27992C-0.000227381 7.14203 -0.0102572 6.99711 0.0105684 6.855L0.763568 1.691C0.815905 1.23279 1.03244 0.809042 1.3731 0.498163C1.71376 0.187284 2.15549 0.010315 2.61657 0L13.3846 0C13.8456 0.010315 14.2874 0.187284 14.628 0.498163C14.9687 0.809042 15.1852 1.23279 15.2376 1.691L15.9906 6.855C16.0114 6.99711 16.0014 7.14203 15.9612 7.27992C15.921 7.4178 15.8515 7.54541 15.7576 7.65405C15.6636 7.7627 15.5474 7.84983 15.4168 7.90953C15.2861 7.96922 15.1442 8.00008 15.0006 8ZM2.15757 6L13.8446 6L13.2606 2L2.74457 2L2.15757 6Z"} /></SvgIcon>
              {/* @ir:end I1:66177;5213:6541 */}
            </Stack>
            {/* @ir:end 1:66177 */}
            {/* @ir:start 1:66178 <Card> card */}
            <Card data-ir-id="1:66178" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "112px", display: "flex", flexDirection: "column", bgcolor: "background.default", border: "1px solid", borderColor: "#e3e3e3", borderRadius: 1 }}>
              <CardContent>
                {/* @ir:start 1:66186 <Select> select */}
                <Controller data-ir-id="1:66186" data-ir-name="<Select>"
                  name={"_select__1_66186"}
                  control={control}
                  render={({ field: controllerField, fieldState }) => {
                    const helperText = resolveFieldErrorMessage({
                      fieldKey: "_select__1_66186",
                      isTouched: fieldState.isTouched,
                      isSubmitted,
                      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                    });
                    return (
                      <FormControl
                        error={Boolean(helperText)}
                        sx={sharedSxStyle3}
                      >
                        <InputLabel id={"_select__1_66186-label"}>{"Person"}</InputLabel>
                        <Select
                          labelId={"_select__1_66186-label"}
                          label={"Person"}
                          value={controllerField.value}
                          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
                          onBlur={controllerField.onBlur}
                          aria-describedby={"_select__1_66186-helper-text"}
                          aria-label={"Person"}
                        >
                          {(selectOptions["_select__1_66186"] ?? []).map((option) => (
                            <MenuItem key={option} value={option}>{option}</MenuItem>
                          ))}
                        </Select>
                        <FormHelperText id={"_select__1_66186-helper-text"}>{helperText}</FormHelperText>
                      </FormControl>
                    );
                  }}
                />
                {/* @ir:end 1:66186 */}
              </CardContent>
            </Card>
            {/* @ir:end 1:66178 */}
          </Stack>
          {/* @ir:end 1:66145 */}
          {/* @ir:start 1:66196 <Stack> stack */}
          <Stack data-ir-id="1:66196" data-ir-name="<Stack>" direction="column" spacing={1.2} sx={{ width: "100%", maxWidth: "960px", minHeight: "407px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1.2, pb: 3.2 }}>
            {/* @ir:start 1:66198 <Stack4>(Nested) stack */}
            <Stack data-ir-id="1:66198" data-ir-name="<Stack4>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "24px", display: "flex", flexDirection: "row", alignItems: "center", gap: 0.8, px: 2 }}>
              {/* @ir:start I1:66198;9445:29980 <Icon> container */}
              <SvgIcon data-ir-id="I1:66198;9445:29980" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle2} viewBox={"0 0 24 24"}><path d={"M7.5625 15.1338C7.86934 15.1333 8.17338 15.1926 8.45703 15.3096C8.74072 15.4266 8.99859 15.5987 9.21582 15.8154C9.43303 16.0322 9.605 16.2898 9.72266 16.5732C9.84031 16.8567 9.90124 17.1609 9.90137 17.4678C9.90148 17.9293 9.76499 18.3807 9.50879 18.7646C9.25256 19.1486 8.8882 19.448 8.46191 19.625C8.03558 19.802 7.5661 19.8484 7.11328 19.7588C6.66038 19.6691 6.24381 19.4472 5.91699 19.1211C5.59028 18.795 5.36798 18.3794 5.27734 17.9268C5.18673 17.4741 5.23218 17.0049 5.4082 16.5781C5.58429 16.1513 5.88312 15.7864 6.2666 15.5293C6.65006 15.2722 7.10085 15.1346 7.5625 15.1338ZM14.5303 15.1338C15.1492 15.1343 15.7429 15.3798 16.1807 15.8174C16.6184 16.2552 16.8647 16.8496 16.8652 17.4688C16.8652 17.9304 16.7282 18.3817 16.4717 18.7656C16.2151 19.1496 15.8505 19.4493 15.4238 19.626C14.9974 19.8026 14.5279 19.8488 14.0752 19.7588C13.6222 19.6687 13.2055 19.4457 12.8789 19.1191C12.5525 18.7926 12.3303 18.3766 12.2402 17.9238C12.1502 17.471 12.1964 17.0018 12.373 16.5752C12.5498 16.1485 12.8494 15.7839 13.2334 15.5273C13.6174 15.2708 14.0685 15.1338 14.5303 15.1338ZM7.47363 17.0234C7.38595 17.041 7.30542 17.0842 7.24219 17.1475C7.17895 17.2108 7.13564 17.2911 7.11816 17.3789C7.1007 17.4667 7.10934 17.5579 7.14355 17.6406C7.1778 17.7233 7.23619 17.794 7.31055 17.8438C7.38504 17.8935 7.47291 17.9199 7.5625 17.9199C7.68254 17.9196 7.79793 17.872 7.88281 17.7871C7.96742 17.7023 8.01525 17.5875 8.01562 17.4678C8.01562 17.3783 7.98912 17.2903 7.93945 17.2158C7.88968 17.1413 7.81813 17.0831 7.73535 17.0488C7.65268 17.0147 7.56137 17.006 7.47363 17.0234ZM14.4424 17.0234C14.3545 17.0409 14.2733 17.0841 14.21 17.1475C14.1467 17.2108 14.1034 17.2912 14.0859 17.3789C14.0685 17.4667 14.0771 17.5579 14.1113 17.6406C14.1456 17.7233 14.204 17.794 14.2783 17.8438C14.3528 17.8935 14.4407 17.9199 14.5303 17.9199C14.6503 17.9197 14.7657 17.872 14.8506 17.7871C14.9352 17.7023 14.983 17.5876 14.9834 17.4678C14.9834 17.3783 14.9569 17.2903 14.9072 17.2158C14.8575 17.1414 14.7867 17.0831 14.7041 17.0488C14.6214 17.0146 14.5301 17.0061 14.4424 17.0234ZM3.54004 0C3.75554 0.000738312 3.96421 0.0754943 4.13184 0.210938C4.2994 0.346336 4.41591 0.53466 4.46191 0.745117L5.13379 4.11035L19.0596 4.11035C19.1978 4.1107 19.3349 4.14146 19.46 4.2002C19.5849 4.25893 19.6957 4.34416 19.7842 4.4502C19.8734 4.55734 19.9371 4.68329 19.9717 4.81836C20.0063 4.95345 20.0111 5.09458 19.9844 5.23145L18.667 12.1406C18.5494 12.7281 18.2321 13.2569 17.7695 13.6377C17.3069 14.0184 16.7271 14.2281 16.1279 14.2305L7.34863 14.2305C6.75245 14.2274 6.17581 14.018 5.71582 13.6387C5.25583 13.2593 4.94081 12.7332 4.82422 12.1484L3.44727 5.27539C3.43619 5.23803 3.42958 5.19912 3.42871 5.16016L2.76758 1.88281L0.941406 1.88281C0.691838 1.88281 0.451862 1.78292 0.275391 1.60645C0.0990942 1.43001 1.06018e-05 1.19084 0 0.941406C0 0.691981 0.0991097 0.45281 0.275391 0.276367C0.451862 0.0998955 0.691838 -4.44089e-16 0.941406 0L3.54004 0ZM5.51074 5.99121L6.67188 11.7754C6.69921 11.9394 6.78528 12.0881 6.91406 12.1934C7.04287 12.2986 7.20583 12.3536 7.37207 12.3477L16.0967 12.3477C16.2643 12.3481 16.4275 12.2911 16.5586 12.1865C16.6896 12.082 16.7815 11.936 16.8184 11.7725L17.9219 5.99121L5.51074 5.99121Z"} /><path d={"M2.331 3.4268e-06C1.86931 0.000794375 1.41822 0.138436 1.03473 0.395534C0.651249 0.652632 0.352589 1.01764 0.176501 1.44444C0.000413328 1.87123 -0.0451991 2.34064 0.0454297 2.79335C0.136058 3.24606 0.35886 3.66174 0.685674 3.98786C1.01249 4.31397 1.42865 4.53589 1.88155 4.62555C2.33445 4.71521 2.80377 4.66859 3.23018 4.49159C3.6566 4.31459 4.02097 4.01515 4.27725 3.63112C4.53352 3.24708 4.6702 2.79569 4.67 2.334C4.66987 2.02711 4.60924 1.72326 4.49159 1.43982C4.37394 1.15638 4.20156 0.898911 3.98433 0.68214C3.76709 0.465369 3.50926 0.293547 3.22556 0.1765C2.94187 0.0594531 2.63789 -0.000522322 2.331 3.4268e-06L2.331 3.4268e-06ZM2.331 2.787C2.24141 2.787 2.15382 2.76043 2.07933 2.71066C2.00483 2.66088 1.94677 2.59013 1.91248 2.50736C1.8782 2.42459 1.86923 2.3335 1.8867 2.24563C1.90418 2.15775 1.94733 2.07704 2.01068 2.01368C2.07403 1.95033 2.15475 1.90719 2.24262 1.88971C2.3305 1.87223 2.42158 1.8812 2.50436 1.91549C2.58713 1.94977 2.65788 2.00783 2.70766 2.08233C2.75743 2.15683 2.784 2.24441 2.784 2.334C2.78374 2.45406 2.73592 2.56913 2.65103 2.65403C2.56613 2.73893 2.45106 2.78674 2.331 2.787Z"} /><path d={"M2.335 0C1.87318 3.55271e-15 1.42173 0.136945 1.03774 0.393518C0.653756 0.650092 0.354473 1.01477 0.177742 1.44143C0.0010114 1.8681 -0.045229 2.33759 0.0448675 2.79054C0.134964 3.24348 0.357351 3.65954 0.683907 3.9861C1.01046 4.31265 1.42652 4.53504 1.87946 4.62513C2.33241 4.71523 2.8019 4.66899 3.22857 4.49226C3.65523 4.31553 4.01991 4.01625 4.27648 3.63226C4.53306 3.24827 4.67 2.79682 4.67 2.335L4.67 2.335C4.66947 1.71588 4.42329 1.12227 3.98551 0.68449C3.54773 0.246707 2.95412 0.000529614 2.335 0L2.335 0ZM2.335 2.787C2.24541 2.787 2.15782 2.76043 2.08333 2.71066C2.00883 2.66088 1.95077 2.59013 1.91648 2.50736C1.8822 2.42458 1.87323 2.3335 1.8907 2.24562C1.90818 2.15775 1.95133 2.07703 2.01468 2.01368C2.07804 1.95033 2.15875 1.90718 2.24662 1.8897C2.3345 1.87222 2.42558 1.8812 2.50836 1.91548C2.59113 1.94977 2.66188 2.00783 2.71166 2.08233C2.76143 2.15682 2.788 2.2444 2.788 2.334L2.788 2.334C2.78774 2.45406 2.73993 2.56913 2.65503 2.65403C2.57013 2.73892 2.45506 2.78674 2.335 2.787Z"} /><path d={"M19.784 4.45C19.6955 4.34389 19.5848 4.25846 19.4597 4.19972C19.3346 4.14098 19.1982 4.11035 19.06 4.11L5.134 4.11L4.462 0.745C4.41603 0.53444 4.29961 0.345858 4.13198 0.210405C3.96434 0.0749514 3.75552 0.000729758 3.54 0L0.941 0C0.691431 -4.44089e-16 0.452084 0.0991409 0.275612 0.275613C0.0991407 0.452084 0 0.691431 0 0.941C0 1.19057 0.0991407 1.42992 0.275612 1.60639C0.452084 1.78286 0.691431 1.882 0.941 1.882L2.768 1.882L3.429 5.16C3.42987 5.19896 3.43592 5.23764 3.447 5.275L4.824 12.148C4.94058 12.7328 5.25554 13.2594 5.71563 13.6388C6.17571 14.0181 6.75269 14.227 7.349 14.23L16.128 14.23C16.7272 14.2276 17.3072 14.0182 17.7699 13.6374C18.2326 13.2566 18.5495 12.7276 18.667 12.14L19.984 5.231C20.0107 5.09414 20.0067 4.95304 19.9721 4.81794C19.9375 4.68285 19.8732 4.55716 19.784 4.45L19.784 4.45ZM16.818 11.772C16.7811 11.9356 16.6896 12.0817 16.5585 12.1862C16.4275 12.2907 16.2647 12.3475 16.097 12.347L7.372 12.347C7.20576 12.3529 7.04306 12.2981 6.91425 12.1929C6.78544 12.0876 6.69934 11.9391 6.672 11.775L5.511 5.991L17.922 5.991L16.818 11.772Z"} /></SvgIcon>
              {/* @ir:end I1:66198;9445:29980 */}
            </Stack>
            {/* @ir:end 1:66198 */}
            {/* @ir:start 1:66199 <Card> card */}
            <Card data-ir-id="1:66199" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "337px", display: "flex", flexDirection: "column", bgcolor: "background.default", border: "1px solid", borderColor: "#e3e3e3", borderRadius: 1 }}>
              <CardContent>
                {/* @ir:start 1:66206 <TextField> input */}
                <Controller data-ir-id="1:66206" data-ir-name="<TextField>"
                  name={"_textfield__1_66206"}
                  control={control}
                  render={({ field: controllerField, fieldState }) => {
                    const helperText = resolveFieldErrorMessage({
                      fieldKey: "_textfield__1_66206",
                      isTouched: fieldState.isTouched,
                      isSubmitted,
                      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                    });
                    return (
                      <TextField
                        label={"Konkrete Bezeichnung des Investitionsobjekts"}
                        value={controllerField.value}
                        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
                        onBlur={controllerField.onBlur}
                        error={Boolean(helperText)}
                        helperText={helperText}
                        aria-label={"Konkrete Bezeichnung des Investitionsobjekts"}
                        aria-describedby={"_textfield__1_66206-helper-text"}
                  sx={sharedSxStyle4}

                        slotProps={{
                          htmlInput: { "aria-describedby": "_textfield__1_66206-helper-text" },
                    formHelperText: { id: "_textfield__1_66206-helper-text" }
                        }}
                      />
                    );
                  }}
                />
                {/* @ir:end 1:66206 */}
                {/* @ir:start 1:66207 <Select> select */}
                <Controller data-ir-id="1:66207" data-ir-name="<Select>"
                  name={"_select__1_66207"}
                  control={control}
                  render={({ field: controllerField, fieldState }) => {
                    const helperText = resolveFieldErrorMessage({
                      fieldKey: "_select__1_66207",
                      isTouched: fieldState.isTouched,
                      isSubmitted,
                      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                    });
                    return (
                      <FormControl
                        error={Boolean(helperText)}
                        sx={sharedSxStyle3}
                      >
                        <InputLabel id={"_select__1_66207-label"}>{"Art des Investitionsobjekts"}</InputLabel>
                        <Select
                          labelId={"_select__1_66207-label"}
                          label={"Art des Investitionsobjekts"}
                          value={controllerField.value}
                          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
                          onBlur={controllerField.onBlur}
                          aria-describedby={"_select__1_66207-helper-text"}
                          aria-label={"Art des Investitionsobjekts"}
                        >
                          {(selectOptions["_select__1_66207"] ?? []).map((option) => (
                            <MenuItem key={option} value={option}>{option}</MenuItem>
                          ))}
                        </Select>
                        <FormHelperText id={"_select__1_66207-helper-text"}>{helperText}</FormHelperText>
                      </FormControl>
                    );
                  }}
                />
                {/* @ir:end 1:66207 */}
                {/* @ir:start 1:66208 <Stack> stack */}
                <Stack data-ir-id="1:66208" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "145px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  {/* @ir:start 1:66210 <Stack2>(Nested) stack */}
                  <Stack data-ir-id="1:66210" data-ir-name="<Stack2>(Nested)" direction="row" spacing={0.8} sx={sharedSxStyle5}>
                    {/* @ir:start I1:66210;9445:27870 <Stack6>(Nested) stack */}
                    <Stack data-ir-id="I1:66210;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2} sx={{ width: "48.1%", maxWidth: "442px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 2 }}>
                      {/* @ir:start I1:66210;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                      <Stack data-ir-id="I1:66210;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "16.5%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                        {/* @ir:start I1:66210;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                        <Stack data-ir-id="I1:66210;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={sharedSxStyle6}>
                          {/* @ir:start I1:66210;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                          <Stack data-ir-id="I1:66210;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={sharedSxStyle7}>
                            {/* @ir:start I1:66210;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                            <Radio data-ir-id="I1:66210;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={sharedSxStyle8} />
                            {/* @ir:end I1:66210;9445:27870;9445:32106;5646:54691 */}
                          </Stack>
                          {/* @ir:end I1:66210;9445:27870;9445:32106;5646:54690 */}
                        </Stack>
                        {/* @ir:end I1:66210;9445:27870;9445:32106;5646:54689 */}
                      </Stack>
                      {/* @ir:end I1:66210;9445:27870;9445:32106 */}
                      {/* @ir:start I1:66210;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                      <Stack data-ir-id="I1:66210;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "20.4%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                        {/* @ir:start I1:66210;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                        <Stack data-ir-id="I1:66210;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={sharedSxStyle9}>
                          {/* @ir:start I1:66210;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                          <Stack data-ir-id="I1:66210;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={sharedSxStyle10}>
                            {/* @ir:start I1:66210;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                            <Radio data-ir-id="I1:66210;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={sharedSxStyle11} />
                            {/* @ir:end I1:66210;9445:27870;9445:32122;5646:54691 */}
                          </Stack>
                          {/* @ir:end I1:66210;9445:27870;9445:32122;5646:54690 */}
                        </Stack>
                        {/* @ir:end I1:66210;9445:27870;9445:32122;5646:54689 */}
                      </Stack>
                      {/* @ir:end I1:66210;9445:27870;9445:32122 */}
                    </Stack>
                    {/* @ir:end I1:66210;9445:27870 */}
                  </Stack>
                  {/* @ir:end 1:66210 */}
                  {/* @ir:start 1:66214 <Divider> divider */}
                  <Divider data-ir-id="1:66214" data-ir-name="<Divider>" aria-hidden="true" sx={{ width: "100%", maxWidth: "918px", minHeight: "1px", display: "flex", flexDirection: "column" }} />
                  {/* @ir:end 1:66214 */}
                  {/* @ir:start 1:66217 <Stack2>(Nested) stack */}
                  <Stack data-ir-id="1:66217" data-ir-name="<Stack2>(Nested)" direction="row" spacing={0.8} sx={sharedSxStyle5}>
                    {/* @ir:start I1:66217;9445:27870 <Stack6>(Nested) stack */}
                    <Stack data-ir-id="I1:66217;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2} sx={{ width: "27.7%", maxWidth: "254px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 2 }}>
                      {/* @ir:start I1:66217;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                      <Stack data-ir-id="I1:66217;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "28.7%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                        {/* @ir:start I1:66217;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                        <Stack data-ir-id="I1:66217;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={sharedSxStyle6}>
                          {/* @ir:start I1:66217;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                          <Stack data-ir-id="I1:66217;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={sharedSxStyle7}>
                            {/* @ir:start I1:66217;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                            <Radio data-ir-id="I1:66217;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={sharedSxStyle8} />
                            {/* @ir:end I1:66217;9445:27870;9445:32106;5646:54691 */}
                          </Stack>
                          {/* @ir:end I1:66217;9445:27870;9445:32106;5646:54690 */}
                        </Stack>
                        {/* @ir:end I1:66217;9445:27870;9445:32106;5646:54689 */}
                      </Stack>
                      {/* @ir:end I1:66217;9445:27870;9445:32106 */}
                      {/* @ir:start I1:66217;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                      <Stack data-ir-id="I1:66217;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "35.4%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                        {/* @ir:start I1:66217;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                        <Stack data-ir-id="I1:66217;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={sharedSxStyle9}>
                          {/* @ir:start I1:66217;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                          <Stack data-ir-id="I1:66217;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={sharedSxStyle10}>
                            {/* @ir:start I1:66217;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                            <Radio data-ir-id="I1:66217;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={sharedSxStyle11} />
                            {/* @ir:end I1:66217;9445:27870;9445:32122;5646:54691 */}
                          </Stack>
                          {/* @ir:end I1:66217;9445:27870;9445:32122;5646:54690 */}
                        </Stack>
                        {/* @ir:end I1:66217;9445:27870;9445:32122;5646:54689 */}
                      </Stack>
                      {/* @ir:end I1:66217;9445:27870;9445:32122 */}
                    </Stack>
                    {/* @ir:end I1:66217;9445:27870 */}
                  </Stack>
                  {/* @ir:end 1:66217 */}
                </Stack>
                {/* @ir:end 1:66208 */}
              </CardContent>
            </Card>
            {/* @ir:end 1:66199 */}
          </Stack>
          {/* @ir:end 1:66196 */}
          {/* @ir:start 1:66245 <Stack> stack */}
          <Stack data-ir-id="1:66245" data-ir-name="<Stack>" direction="column" spacing={1.2} sx={{ width: "100%", maxWidth: "960px", minHeight: "531px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.2, pb: 1.2 }}>
            {/* @ir:start 1:66247 <Stack3>(Nested) stack */}
            <Stack data-ir-id="1:66247" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "24px", display: "flex", flexDirection: "row", alignItems: "center", gap: 0.8, px: 2 }}>
              {/* @ir:start I1:66247;9445:28917 <Icon> container */}
              <SvgIcon data-ir-id="I1:66247;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle2} viewBox={"0 0 24 24"}><path d={"M5.63443 6.13477C6.99218 5.86478 8.39942 6.00344 9.67838 6.5332C10.9574 7.06302 12.0508 7.96022 12.82 9.11133C13.589 10.2624 13.9997 11.6156 13.9997 13C13.9976 14.8558 13.2592 16.635 11.9469 17.9473C10.6347 19.2595 8.85551 19.9979 6.99967 20C5.61531 20 4.26208 19.5894 3.111 18.8203C1.95988 18.0512 1.06269 16.9578 0.532872 15.6787C0.00309961 14.3997 -0.135578 12.9925 0.134434 11.6348C0.404531 10.2769 1.07051 9.02877 2.04947 8.0498C3.02844 7.07086 4.27658 6.40486 5.63443 6.13477ZM16.9997 0C17.2649 1.76779e-05 17.5192 0.105448 17.7067 0.292969C17.8942 0.480502 17.9997 0.734799 17.9997 1L17.9997 3C18.2649 3.00002 18.5192 3.10545 18.7067 3.29297C18.8942 3.4805 18.9997 3.7348 18.9997 4L18.9997 7C18.9997 7.2652 18.8942 7.5195 18.7067 7.70703C18.5192 7.89455 18.2649 7.99998 17.9997 8L16.9997 8L16.9997 9L18.9997 9C19.2649 9.00002 19.5192 9.10545 19.7067 9.29297C19.8942 9.4805 19.9997 9.7348 19.9997 10L19.9997 13C19.9997 13.2652 19.8942 13.5195 19.7067 13.707C19.5192 13.8946 19.2649 14 18.9997 14L17.9997 14L17.9997 15C18.2649 15 18.5192 15.1054 18.7067 15.293C18.8942 15.4805 18.9997 15.7348 18.9997 16L18.9997 19C18.9997 19.2652 18.8942 19.5195 18.7067 19.707C18.5192 19.8946 18.2649 20 17.9997 20L10.8639 20C11.7766 19.4938 12.5823 18.8144 13.235 18L16.9997 18L16.9997 17L13.9176 17C14.2803 16.3737 14.5561 15.7008 14.737 15L15.9997 15L15.9997 14L14.9303 14C15.0223 13.3365 15.0223 12.6635 14.9303 12L17.9997 12L17.9997 11L14.737 11C14.5561 10.2992 14.2803 9.62635 13.9176 9L14.9997 9L14.9997 8L13.235 8C12.5823 7.18563 11.7766 6.5062 10.8639 6L16.9997 6L16.9997 5L7.99967 5L7.99967 5.06934C7.66812 5.02558 7.33409 5.0022 6.99967 5C6.66523 5.0022 6.33124 5.02558 5.99967 5.06934L5.99967 5C5.73447 5 5.48017 4.89455 5.29264 4.70703C5.1051 4.5195 4.99967 4.26522 4.99967 4L4.99967 1C4.99967 0.734784 5.1051 0.480505 5.29264 0.292969C5.48017 0.105453 5.73447 4.44063e-16 5.99967 0L16.9997 0ZM6.99967 8C6.01076 8 5.04359 8.29337 4.22135 8.84277C3.39926 9.39217 2.75892 10.1734 2.38053 11.0869C2.00215 12.0005 1.90246 13.0057 2.09537 13.9756C2.28831 14.9455 2.76527 15.8359 3.46451 16.5352C4.16377 17.2344 5.05419 17.7114 6.02408 17.9043C6.99394 18.0972 7.99916 17.9975 8.91276 17.6191C9.82626 17.2408 10.6075 16.6004 11.1569 15.7783C11.7063 14.9561 11.9997 13.9889 11.9997 13C11.9981 11.6744 11.4712 10.4032 10.5338 9.46582C9.59653 8.5285 8.32524 8.00161 6.99967 8ZM10.4997 12.5C10.6323 12.5 10.7594 12.5527 10.8532 12.6465C10.9469 12.7402 10.9997 12.8674 10.9997 13C10.9997 14.0609 10.5779 15.078 9.82779 15.8281C9.07766 16.5783 8.06051 17 6.99967 17C6.86708 17 6.73992 16.9473 6.64615 16.8535C6.55238 16.7597 6.49967 16.6326 6.49967 16.5C6.49967 16.3674 6.55238 16.2403 6.64615 16.1465C6.73992 16.0527 6.86708 16 6.99967 16C7.79529 16 8.55817 15.6837 9.12076 15.1211C9.68335 14.5585 9.99967 13.7956 9.99967 13C9.99967 12.8674 10.0524 12.7403 10.1462 12.6465C10.2399 12.5527 10.3671 12.5 10.4997 12.5ZM6.99967 9C7.13225 9.00002 7.25943 9.05273 7.35318 9.14648C7.44693 9.24025 7.49967 9.36741 7.49967 9.5C7.49967 9.63259 7.44693 9.75975 7.35318 9.85352C7.25943 9.94727 7.13225 9.99998 6.99967 10C6.20403 10 5.44118 10.3163 4.87857 10.8789C4.31597 11.4415 3.99967 12.2044 3.99967 13C3.99967 13.1326 3.94693 13.2598 3.85318 13.3535C3.75943 13.4473 3.63225 13.5 3.49967 13.5C3.36708 13.5 3.23992 13.4473 3.14615 13.3535C3.05238 13.2597 2.99967 13.1326 2.99967 13C2.99967 11.9391 3.4214 10.922 4.17154 10.1719C4.92169 9.42175 5.93882 9 6.99967 9ZM6.99967 3L15.9997 3L15.9997 2L6.99967 2L6.99967 3Z"} /><path d={"M14 9L12 9L12 8L13 8C13.2652 8 13.5196 7.89464 13.7071 7.70711C13.8946 7.51957 14 7.26522 14 7L14 4C14 3.73478 13.8946 3.48043 13.7071 3.29289C13.5196 3.10536 13.2652 3 13 3L13 1C13 0.734784 12.8946 0.48043 12.7071 0.292893C12.5196 0.105357 12.2652 6.66134e-16 12 0L1 0C0.734784 4.44089e-16 0.48043 0.105357 0.292893 0.292893C0.105357 0.48043 0 0.734784 0 1L0 4C0 4.26522 0.105357 4.51957 0.292893 4.70711C0.48043 4.89464 0.734784 5 1 5L1 5.069C1.33158 5.02524 1.66556 5.0022 2 5C2.33444 5.0022 2.66842 5.02524 3 5.069L3 5L12 5L12 6L5.864 6C6.77682 6.50621 7.58218 7.18555 8.235 8L10 8L10 9L8.918 9C9.28062 9.62635 9.55616 10.2992 9.737 11L13 11L13 12L9.931 12C10.023 12.6635 10.023 13.3365 9.931 14L11 14L11 15L9.737 15C9.55616 15.7008 9.28062 16.3736 8.918 17L12 17L12 18L8.235 18C7.58218 18.8144 6.77682 19.4938 5.864 20L13 20C13.2652 20 13.5196 19.8946 13.7071 19.7071C13.8946 19.5196 14 19.2652 14 19L14 16C14 15.7348 13.8946 15.4804 13.7071 15.2929C13.5196 15.1054 13.2652 15 13 15L13 14L14 14C14.2652 14 14.5196 13.8946 14.7071 13.7071C14.8946 13.5196 15 13.2652 15 13L15 10C15 9.73478 14.8946 9.48043 14.7071 9.29289C14.5196 9.10536 14.2652 9 14 9ZM11 3L2 3L2 2L11 2L11 3Z"} /><path d={"M7 14C5.61553 14 4.26216 13.5895 3.11101 12.8203C1.95987 12.0511 1.06266 10.9579 0.532846 9.67879C0.00303298 8.3997 -0.13559 6.99224 0.134506 5.63437C0.404603 4.2765 1.07129 3.02922 2.05026 2.05026C3.02922 1.07129 4.2765 0.404603 5.63437 0.134506C6.99224 -0.13559 8.3997 0.00303298 9.67879 0.532846C10.9579 1.06266 12.0511 1.95987 12.8203 3.11101C13.5895 4.26216 14 5.61553 14 7C13.9979 8.85587 13.2597 10.6351 11.9474 11.9474C10.6351 13.2597 8.85587 13.9979 7 14L7 14ZM7 2C6.0111 2 5.0444 2.29325 4.22215 2.84266C3.39991 3.39206 2.75904 4.17296 2.38061 5.08659C2.00217 6.00022 1.90315 7.00555 2.09608 7.97545C2.289 8.94536 2.76521 9.83627 3.46447 10.5355C4.16373 11.2348 5.05465 11.711 6.02455 11.9039C6.99446 12.0969 7.99979 11.9978 8.91342 11.6194C9.82705 11.241 10.6079 10.6001 11.1574 9.77785C11.7068 8.95561 12 7.98891 12 7C11.9984 5.67441 11.4711 4.40356 10.5338 3.46622C9.59645 2.52888 8.3256 2.00159 7 2L7 2Z"} /><path d={"M0.5 4.5C0.367392 4.5 0.240215 4.44732 0.146447 4.35355C0.0526785 4.25979 0 4.13261 0 4C0 2.93913 0.421427 1.92172 1.17157 1.17157C1.92172 0.421427 2.93913 1.77636e-15 4 0C4.13261 0 4.25979 0.052678 4.35355 0.146446C4.44732 0.240214 4.5 0.367392 4.5 0.5C4.5 0.632608 4.44732 0.759786 4.35355 0.853554C4.25979 0.947322 4.13261 1 4 1C3.20435 1 2.44129 1.31607 1.87868 1.87868C1.31607 2.44129 1 3.20435 1 4C1 4.13261 0.947321 4.25979 0.853553 4.35355C0.759785 4.44732 0.632608 4.5 0.5 4.5Z"} /><path d={"M0.5 4.5C0.367392 4.5 0.240214 4.44732 0.146446 4.35355C0.052678 4.25979 0 4.13261 0 4C0 3.86739 0.052678 3.74021 0.146446 3.64645C0.240214 3.55268 0.367392 3.5 0.5 3.5C1.29565 3.5 2.05871 3.18393 2.62132 2.62132C3.18393 2.05871 3.5 1.29565 3.5 0.5C3.5 0.367392 3.55268 0.240214 3.64645 0.146446C3.74021 0.052678 3.86739 0 4 0C4.13261 0 4.25979 0.052678 4.35355 0.146446C4.44732 0.240214 4.5 0.367392 4.5 0.5C4.5 1.56087 4.07857 2.57828 3.32843 3.32843C2.57828 4.07857 1.56087 4.5 0.5 4.5Z"} /></SvgIcon>
              {/* @ir:end I1:66247;9445:28917 */}
            </Stack>
            {/* @ir:end 1:66247 */}
            {/* @ir:start 1:66248 <Card> card */}
            <Card data-ir-id="1:66248" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "481px", display: "flex", flexDirection: "column", bgcolor: "background.default", border: "1px solid", borderColor: "#e3e3e3", borderRadius: 1 }}>
              <CardContent>
                {/* @ir:start 1:66256 <Stack> stack */}
                <Stack data-ir-id="1:66256" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "128px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 0.8 }}>
                  {/* @ir:start 1:66258 <Stack2>(Nested) stack */}
                  <Stack data-ir-id="1:66258" data-ir-name="<Stack2>(Nested)" direction="row" spacing={0.8} sx={sharedSxStyle5}>
                    {/* @ir:start I1:66258;9445:27856 <IconButton> button */}
                    <IconButton data-ir-id="I1:66258;9445:27856" data-ir-name="<IconButton>" aria-label="\u003CIconButton\u003E" sx={{ width: "3.1%", maxWidth: "28px", minHeight: "28px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 0.4, borderRadius: 8, color: "#565656" }}><SvgIcon aria-hidden="true" sx={{ width: "20px", height: "20px", color: "#565656", fontSize: "inherit" }} viewBox={"0 0 20 20"}><path d={"M6.70715 0.160277C8.32366 -0.161267 9.99986 0.00317946 11.5226 0.63391C13.0451 1.26463 14.3462 2.33301 15.2618 3.70325C16.1775 5.07365 16.6661 6.68495 16.6661 8.33313C16.6637 10.5425 15.7851 12.6605 14.2228 14.2228C12.6605 15.7851 10.5425 16.6637 8.33313 16.6661C6.68495 16.6661 5.07365 16.1775 3.70325 15.2618C2.33301 14.3462 1.26463 13.0451 0.63391 11.5226C0.00317946 9.99986 -0.161267 8.32366 0.160277 6.70715C0.481857 5.09075 1.27518 3.60592 2.44055 2.44055C3.60592 1.27518 5.09075 0.481857 6.70715 0.160277ZM8.33313 1.66614C7.01459 1.66614 5.72535 2.05762 4.62903 2.79016C3.53284 3.52269 2.67849 4.56428 2.17395 5.78235C1.66949 7.00042 1.53783 8.34083 1.79504 9.63391C2.05231 10.927 2.68698 12.1147 3.61926 13.047C4.55155 13.9793 5.73924 14.6139 7.03235 14.8712C8.32542 15.1284 9.66584 14.9968 10.8839 14.4923C12.102 13.9878 13.1436 13.1334 13.8761 12.0372C14.6086 10.9409 15.0001 9.65167 15.0001 8.33313C14.9981 6.56563 14.2949 4.87103 13.045 3.62121C11.7952 2.3714 10.1006 1.66812 8.33313 1.66614ZM8.33313 7.50012C8.55414 7.50012 8.76572 7.58798 8.922 7.74426C9.07828 7.90054 9.16614 8.11211 9.16614 8.33313L9.16614 11.6661C9.16614 11.8872 9.07828 12.0997 8.922 12.256C8.76575 12.4121 8.55399 12.5001 8.33313 12.5001C8.11227 12.5001 7.90051 12.4121 7.74426 12.256C7.58798 12.0997 7.50012 11.8872 7.50012 11.6661L7.50012 8.33313C7.50012 8.11211 7.58798 7.90054 7.74426 7.74426C7.90054 7.58798 8.11211 7.50012 8.33313 7.50012ZM8.33313 4.16614C8.55399 4.16614 8.76575 4.2542 8.922 4.41028C9.07828 4.56656 9.16614 4.77911 9.16614 5.00012C9.16605 5.22102 9.0782 5.43278 8.922 5.58899C8.76573 5.74517 8.55407 5.83313 8.33313 5.83313C8.11219 5.83313 7.90053 5.74517 7.74426 5.58899C7.58806 5.43278 7.50021 5.22102 7.50012 5.00012C7.50012 4.77911 7.58798 4.56656 7.74426 4.41028C7.90051 4.2542 8.11227 4.16614 8.33313 4.16614Z"} /><path d={"M0.833333 1.66667C0.61232 1.66667 0.400358 1.57887 0.244078 1.42259C0.0877975 1.26631 0 1.05435 0 0.833333C0 0.61232 0.0877975 0.400358 0.244078 0.244078C0.400358 0.0877975 0.61232 -7.40149e-16 0.833333 0C1.05435 -7.40149e-16 1.26631 0.0877975 1.42259 0.244078C1.57887 0.400358 1.66667 0.61232 1.66667 0.833333C1.66667 1.05435 1.57887 1.26631 1.42259 1.42259C1.26631 1.57887 1.05435 1.66667 0.833333 1.66667Z"} /><path d={"M0.833333 5C0.61232 5 0.400358 4.9122 0.244078 4.75592C0.0877975 4.59964 0 4.38768 0 4.16667L0 0.833333C0 0.61232 0.0877975 0.400358 0.244078 0.244078C0.400358 0.0877975 0.61232 0 0.833333 0C1.05435 0 1.26631 0.0877975 1.42259 0.244078C1.57887 0.400358 1.66667 0.61232 1.66667 0.833333L1.66667 4.16667C1.66667 4.38768 1.57887 4.59964 1.42259 4.75592C1.26631 4.9122 1.05435 5 0.833333 5Z"} /><path d={"M8.33334 16.6667C6.68516 16.6667 5.07399 16.1779 3.70358 15.2622C2.33318 14.3466 1.26507 13.0451 0.634341 11.5224C0.0036107 9.99965 -0.161417 8.32409 0.160126 6.70758C0.48167 5.09108 1.27534 3.60622 2.44078 2.44078C3.60622 1.27534 5.09108 0.48167 6.70758 0.160126C8.32409 -0.161417 9.99965 0.0036107 11.5224 0.634341C13.0451 1.26507 14.3466 2.33318 15.2622 3.70358C16.1779 5.07399 16.6667 6.68516 16.6667 8.33334C16.6642 10.5427 15.7855 12.6609 14.2232 14.2232C12.6609 15.7855 10.5427 16.6642 8.33334 16.6667L8.33334 16.6667ZM8.33334 1.66667C7.0148 1.66667 5.72586 2.05766 4.62954 2.79021C3.53321 3.52275 2.67872 4.56394 2.17414 5.78211C1.66956 7.00029 1.53753 8.34073 1.79477 9.63394C2.052 10.9271 2.68694 12.115 3.61929 13.0474C4.55164 13.9797 5.73953 14.6147 7.03274 14.8719C8.32594 15.1291 9.66639 14.9971 10.8846 14.4925C12.1027 13.9879 13.1439 13.1335 13.8765 12.0371C14.609 10.9408 15 9.65188 15 8.33334C14.998 6.56584 14.295 4.8713 13.0452 3.62148C11.7954 2.37167 10.1008 1.66866 8.33334 1.66667L8.33334 1.66667Z"} /></SvgIcon></IconButton>
                    {/* @ir:end I1:66258;9445:27856 */}
                    {/* @ir:start I1:66258;9445:27870 <Stack6>(Nested) stack */}
                    <Stack data-ir-id="I1:66258;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2} sx={{ width: "61%", maxWidth: "560px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 2 }}>
                      {/* @ir:start I1:66258;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                      <Stack data-ir-id="I1:66258;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "17.3%", maxWidth: "97px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                        {/* @ir:start I1:66258;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                        <Stack data-ir-id="I1:66258;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "97px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                          {/* @ir:start I1:66258;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                          <Stack data-ir-id="I1:66258;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={{ width: "100%", maxWidth: "97px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1.6, py: 1.6 }}>
                            {/* @ir:start I1:66258;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                            <Radio data-ir-id="I1:66258;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={{ width: "41.2%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                            {/* @ir:end I1:66258;9445:27870;9445:32106;5646:54691 */}
                          </Stack>
                          {/* @ir:end I1:66258;9445:27870;9445:32106;5646:54690 */}
                        </Stack>
                        {/* @ir:end I1:66258;9445:27870;9445:32106;5646:54689 */}
                      </Stack>
                      {/* @ir:end I1:66258;9445:27870;9445:32106 */}
                      {/* @ir:start I1:66258;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                      <Stack data-ir-id="I1:66258;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "18.2%", maxWidth: "102px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                        {/* @ir:start I1:66258;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                        <Stack data-ir-id="I1:66258;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "102px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                          {/* @ir:start I1:66258;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                          <Stack data-ir-id="I1:66258;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={{ width: "100%", maxWidth: "102px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1.6, py: 1.6 }}>
                            {/* @ir:start I1:66258;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                            <Radio data-ir-id="I1:66258;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={{ width: "39.2%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                            {/* @ir:end I1:66258;9445:27870;9445:32122;5646:54691 */}
                          </Stack>
                          {/* @ir:end I1:66258;9445:27870;9445:32122;5646:54690 */}
                        </Stack>
                        {/* @ir:end I1:66258;9445:27870;9445:32122;5646:54689 */}
                      </Stack>
                      {/* @ir:end I1:66258;9445:27870;9445:32122 */}
                    </Stack>
                    {/* @ir:end I1:66258;9445:27870 */}
                  </Stack>
                  {/* @ir:end 1:66258 */}
                  {/* @ir:start 1:66275 <Alert> alert */}
                  <Alert data-ir-id="1:66275" data-ir-name="<Alert>" severity={"info"} sx={{ width: "100%", maxWidth: "918px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", py: 1.2, px: 2, borderRadius: 1 }}>{"Die MwSt. ist nicht Teil des Finanzierungsbedarfs."}</Alert>
                  {/* @ir:end 1:66275 */}
                </Stack>
                {/* @ir:end 1:66256 */}
                {/* @ir:start 1:66276 <TextField> input */}
                <Controller data-ir-id="1:66276" data-ir-name="<TextField>"
                  name={"_textfield__1_66276"}
                  control={control}
                  render={({ field: controllerField, fieldState }) => {
                    const helperText = resolveFieldErrorMessage({
                      fieldKey: "_textfield__1_66276",
                      isTouched: fieldState.isTouched,
                      isSubmitted,
                      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                    });
                    return (
                      <TextField
                        label={"Höhe des Kaufpreises (Netto)"}
                        value={controllerField.value}
                        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
                        onBlur={controllerField.onBlur}
                        error={Boolean(helperText)}
                        helperText={helperText}
                        aria-label={"Höhe des Kaufpreises (Netto)"}
                        aria-describedby={"_textfield__1_66276-helper-text"}
                  sx={sharedSxStyle4}

                        slotProps={{
                          htmlInput: { "aria-describedby": "_textfield__1_66276-helper-text" },
                    formHelperText: { id: "_textfield__1_66276-helper-text" }
                        }}
                      />
                    );
                  }}
                />
                {/* @ir:end 1:66276 */}
                {/* @ir:start 1:66277 <Select> select */}
                <Controller data-ir-id="1:66277" data-ir-name="<Select>"
                  name={"_select__1_66277"}
                  control={control}
                  render={({ field: controllerField, fieldState }) => {
                    const helperText = resolveFieldErrorMessage({
                      fieldKey: "_select__1_66277",
                      isTouched: fieldState.isTouched,
                      isSubmitted,
                      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                    });
                    return (
                      <FormControl
                        error={Boolean(helperText)}
                        sx={sharedSxStyle3}
                      >
                        <InputLabel id={"_select__1_66277-label"}>{"Anfallender MwSt.-Satz bei Kauf"}</InputLabel>
                        <Select
                          labelId={"_select__1_66277-label"}
                          label={"Anfallender MwSt.-Satz bei Kauf"}
                          value={controllerField.value}
                          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
                          onBlur={controllerField.onBlur}
                          aria-describedby={"_select__1_66277-helper-text"}
                          aria-label={"Anfallender MwSt.-Satz bei Kauf"}
                        >
                          {(selectOptions["_select__1_66277"] ?? []).map((option) => (
                            <MenuItem key={option} value={option}>{option}</MenuItem>
                          ))}
                        </Select>
                        <FormHelperText id={"_select__1_66277-helper-text"}>{helperText}</FormHelperText>
                      </FormControl>
                    );
                  }}
                />
                {/* @ir:end 1:66277 */}
                {/* @ir:start 1:66278 <TextField> input */}
                <Controller data-ir-id="1:66278" data-ir-name="<TextField>"
                  name={"_textfield__1_66278"}
                  control={control}
                  render={({ field: controllerField, fieldState }) => {
                    const helperText = resolveFieldErrorMessage({
                      fieldKey: "_textfield__1_66278",
                      isTouched: fieldState.isTouched,
                      isSubmitted,
                      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                    });
                    return (
                      <TextField
                        label={"Höhe der Nebenkosten (Brutto)"}
                        value={controllerField.value}
                        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
                        onBlur={controllerField.onBlur}
                        error={Boolean(helperText)}
                        helperText={helperText}
                        aria-label={"Höhe der Nebenkosten (Brutto)"}
                        aria-describedby={"_textfield__1_66278-helper-text"}
                  sx={sharedSxStyle4}

                        slotProps={{
                          htmlInput: { "aria-describedby": "_textfield__1_66278-helper-text" },
                    formHelperText: { id: "_textfield__1_66278-helper-text" }
                        }}
                      />
                    );
                  }}
                />
                {/* @ir:end 1:66278 */}
                {/* @ir:start 1:66279 <Divider> divider */}
                <Divider data-ir-id="1:66279" data-ir-name="<Divider>" aria-hidden="true" sx={{ width: "95.8%", maxWidth: "918px", minHeight: "13px", display: "flex", flexDirection: "column", pt: 1.2 }} />
                {/* @ir:end 1:66279 */}
                {/* @ir:start 1:66280 <Stack2>(Nested) stack */}
                <Stack data-ir-id="1:66280" data-ir-name="<Stack2>(Nested)" direction="row" spacing={0} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center", pt: 1.2, pr: 2, pl: 2 }}>
                  {/* @ir:start I1:66280;9445:27870 <Chip> chip */}
                  <Chip data-ir-id="I1:66280;9445:27870" data-ir-name="<Chip>" label={"50.000,00 €"} variant="filled" size="medium" sx={{ width: "13.3%", maxWidth: "122px", minHeight: "28px", display: "flex", flexDirection: "row", alignItems: "center", py: 0.4, px: 0.8, bgcolor: "#565656", borderRadius: 8 }} />
                  {/* @ir:end I1:66280;9445:27870 */}
                </Stack>
                {/* @ir:end 1:66280 */}
              </CardContent>
            </Card>
            {/* @ir:end 1:66248 */}
          </Stack>
          {/* @ir:end 1:66245 */}
          {/* @ir:start 1:66307 <Stack> stack */}
          <Stack data-ir-id="1:66307" data-ir-name="<Stack>" direction="column" spacing={1.2} sx={{ width: "100%", maxWidth: "960px", minHeight: "286px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1.2, pb: 3.2 }}>
            {/* @ir:start 1:66309 <Card> card */}
            <Card data-ir-id="1:66309" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "252px", display: "flex", flexDirection: "column", border: "1px solid", borderColor: "#e3e3e3", borderRadius: 1 }}>
              <CardContent>
                {/* @ir:start 1:66319 <Stack2>(Nested) stack */}
                <Stack data-ir-id="1:66319" data-ir-name="<Stack2>(Nested)" direction="row" spacing={0.8} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", gap: 0.8, px: 2 }}>
                  {/* @ir:start I1:66319;9445:27870 <Stack6>(Nested) stack */}
                  <Stack data-ir-id="I1:66319;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2} sx={{ width: "60%", maxWidth: "551px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 2 }}>
                    {/* @ir:start I1:66319;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                    <Stack data-ir-id="I1:66319;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "13.2%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                      {/* @ir:start I1:66319;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                      <Stack data-ir-id="I1:66319;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={sharedSxStyle6}>
                        {/* @ir:start I1:66319;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                        <Stack data-ir-id="I1:66319;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={sharedSxStyle7}>
                          {/* @ir:start I1:66319;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                          <Radio data-ir-id="I1:66319;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={sharedSxStyle8} />
                          {/* @ir:end I1:66319;9445:27870;9445:32106;5646:54691 */}
                        </Stack>
                        {/* @ir:end I1:66319;9445:27870;9445:32106;5646:54690 */}
                      </Stack>
                      {/* @ir:end I1:66319;9445:27870;9445:32106;5646:54689 */}
                    </Stack>
                    {/* @ir:end I1:66319;9445:27870;9445:32106 */}
                    {/* @ir:start I1:66319;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                    <Stack data-ir-id="I1:66319;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={0.8} sx={{ width: "16.3%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.8 }}>
                      {/* @ir:start I1:66319;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                      <Stack data-ir-id="I1:66319;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={sharedSxStyle9}>
                        {/* @ir:start I1:66319;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                        <Stack data-ir-id="I1:66319;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.6} sx={sharedSxStyle10}>
                          {/* @ir:start I1:66319;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                          <Radio data-ir-id="I1:66319;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={sharedSxStyle11} />
                          {/* @ir:end I1:66319;9445:27870;9445:32122;5646:54691 */}
                        </Stack>
                        {/* @ir:end I1:66319;9445:27870;9445:32122;5646:54690 */}
                      </Stack>
                      {/* @ir:end I1:66319;9445:27870;9445:32122;5646:54689 */}
                    </Stack>
                    {/* @ir:end I1:66319;9445:27870;9445:32122 */}
                  </Stack>
                  {/* @ir:end I1:66319;9445:27870 */}
                </Stack>
                {/* @ir:end 1:66319 */}
                {/* @ir:start 1:66320 <Stack> stack */}
                <Stack data-ir-id="1:66320" data-ir-name="<Stack>" direction="column" spacing={1.2} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "156px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1.2 }}>
                  {/* @ir:start 1:66322 <TextField> input */}
                  <Controller data-ir-id="1:66322" data-ir-name="<TextField>"
                    name={"_textfield__1_66322"}
                    control={control}
                    render={({ field: controllerField, fieldState }) => {
                      const helperText = resolveFieldErrorMessage({
                        fieldKey: "_textfield__1_66322",
                        isTouched: fieldState.isTouched,
                        isSubmitted,
                        fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                      });
                      return (
                        <TextField
                          label={"Höhe der Betriebsmittel"}
                          value={controllerField.value}
                          onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
                          onBlur={controllerField.onBlur}
                          error={Boolean(helperText)}
                          helperText={helperText}
                          aria-label={"Höhe der Betriebsmittel"}
                          aria-describedby={"_textfield__1_66322-helper-text"}
                    sx={{
                      width: "100%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column", gap: 0.8,
                      "& .MuiOutlinedInput-root": { fontFamily: "Sparkasse Rg, Roboto, Arial, sans-serif", color: "primary.main" },
                      "& .MuiInputLabel-root": { fontFamily: "Sparkasse Rg, Roboto, Arial, sans-serif", color: "#565656" }
                    }}

                          slotProps={{
                            htmlInput: { "aria-describedby": "_textfield__1_66322-helper-text" },
                      formHelperText: { id: "_textfield__1_66322-helper-text" }
                          }}
                        />
                      );
                    }}
                  />
                  {/* @ir:end 1:66322 */}
                  {/* @ir:start 1:66323 <Alert> alert */}
                  <Alert data-ir-id="1:66323" data-ir-name="<Alert>" severity={"info"} sx={{ width: "100%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", py: 1.2, px: 2, borderRadius: 1 }}>{"Die Höhe der Betriebsmittel wurde automatisch aus der MwSt. des Kaufpreises ermittelt.\nFür die Betriebsmittel wird ein separater Bedarf angelegt."}</Alert>
                  {/* @ir:end 1:66323 */}
                </Stack>
                {/* @ir:end 1:66320 */}
              </CardContent>
            </Card>
            {/* @ir:end 1:66309 */}
          </Stack>
          {/* @ir:end 1:66307 */}
          {/* @ir:start 1:67438 <Accordion> accordion */}
          <Accordion data-ir-id="1:67438" data-ir-name="<Accordion>"
            expanded={accordionState["_accordion__1_67438"] ?? true}
            onChange={(_, expanded) => updateAccordionState("_accordion__1_67438", expanded)}
            disableGutters
            elevation={0}
            square
            sx={sharedSxStyle12}
          >
            <AccordionSummary id={"accordion-header-_accordion__1_67438"} aria-controls={"accordion-panel-_accordion__1_67438"} expandIcon={<ExpandMoreIcon fontSize="small" />} sx={sharedSxStyle13}>
              <Box sx={sharedSxStyle14}>
                {/* @ir:start I1:67438;6585:1196 Content stack */}
                <Stack data-ir-id="I1:67438;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                  {/* @ir:start I1:67438;6585:1197 <Stack3>(Nested) stack */}
                  <Stack data-ir-id="I1:67438;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                    {/* @ir:start I1:67438;6585:1197;9445:28917 <Icon> container */}
                    <SvgIcon data-ir-id="I1:67438;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M13.5 0C13.6989 0 13.8896 0.0790744 14.0303 0.219727C14.1709 0.360379 14.25 0.551088 14.25 0.75L14.25 1.5L18 1.5C18.3978 1.5 18.7792 1.65815 19.0605 1.93945C19.3419 2.22076 19.5 2.60218 19.5 3L19.5 18C19.5 18.3978 19.3419 18.7792 19.0605 19.0605C18.7792 19.3419 18.3978 19.5 18 19.5L1.5 19.5C1.10218 19.5 0.720758 19.3419 0.439453 19.0605C0.158149 18.7792 0 18.3978 0 18L0 3C0 2.60218 0.158149 2.22076 0.439453 1.93945C0.720758 1.65815 1.10218 1.5 1.5 1.5L5.25 1.5L5.25 0.75C5.25 0.551088 5.32907 0.360379 5.46973 0.219727C5.61038 0.0790743 5.80109 0 6 0C6.19891 0 6.38962 0.0790743 6.53027 0.219727C6.67093 0.360379 6.75 0.551088 6.75 0.75L6.75 1.5L12.75 1.5L12.75 0.75C12.75 0.551088 12.8291 0.360379 12.9697 0.219727C13.1104 0.0790744 13.3011 0 13.5 0ZM1.5 18L18 18L18 7.5L1.5 7.5L1.5 18ZM4.12598 15C4.33249 15.0001 4.49988 15.1675 4.5 15.374L4.5 16.126C4.49988 16.3325 4.33249 16.4999 4.12598 16.5L3.37402 16.5C3.16751 16.4999 3.00012 16.3325 3 16.126L3 15.374C3.00012 15.1675 3.16751 15.0001 3.37402 15L4.12598 15ZM7.12598 15C7.33249 15.0001 7.49988 15.1675 7.5 15.374L7.5 16.126C7.49988 16.3325 7.33249 16.4999 7.12598 16.5L6.37402 16.5C6.16751 16.4999 6.00012 16.3325 6 16.126L6 15.374C6.00012 15.1675 6.16751 15.0001 6.37402 15L7.12598 15ZM10.126 15C10.3325 15.0001 10.4999 15.1675 10.5 15.374L10.5 16.126C10.4999 16.3325 10.3325 16.4999 10.126 16.5L9.37402 16.5C9.16751 16.4999 9.00012 16.3325 9 16.126L9 15.374C9.00012 15.1675 9.16751 15.0001 9.37402 15L10.126 15ZM13.126 15C13.3325 15.0001 13.4999 15.1675 13.5 15.374L13.5 16.126C13.4999 16.3325 13.3325 16.4999 13.126 16.5L12.374 16.5C12.1675 16.4999 12.0001 16.3325 12 16.126L12 15.374C12.0001 15.1675 12.1675 15.0001 12.374 15L13.126 15ZM4.12598 12C4.33249 12.0001 4.49988 12.1675 4.5 12.374L4.5 13.126C4.49988 13.3325 4.33249 13.4999 4.12598 13.5L3.37402 13.5C3.16751 13.4999 3.00012 13.3325 3 13.126L3 12.374C3.00012 12.1675 3.16751 12.0001 3.37402 12L4.12598 12ZM7.12598 12C7.33249 12.0001 7.49988 12.1675 7.5 12.374L7.5 13.126C7.49988 13.3325 7.33249 13.4999 7.12598 13.5L6.37402 13.5C6.16751 13.4999 6.00012 13.3325 6 13.126L6 12.374C6.00012 12.1675 6.16751 12.0001 6.37402 12L7.12598 12ZM10.126 12C10.3325 12.0001 10.4999 12.1675 10.5 12.374L10.5 13.126C10.4999 13.3325 10.3325 13.4999 10.126 13.5L9.37402 13.5C9.16751 13.4999 9.00012 13.3325 9 13.126L9 12.374C9.00012 12.1675 9.16751 12.0001 9.37402 12L10.126 12ZM13.126 12C13.3325 12.0001 13.4999 12.1675 13.5 12.374L13.5 13.126C13.4999 13.3325 13.3325 13.4999 13.126 13.5L12.374 13.5C12.1675 13.4999 12.0001 13.3325 12 13.126L12 12.374C12.0001 12.1675 12.1675 12.0001 12.374 12L13.126 12ZM16.126 12C16.3325 12.0001 16.4999 12.1675 16.5 12.374L16.5 13.126C16.4999 13.3325 16.3325 13.4999 16.126 13.5L15.374 13.5C15.1675 13.4999 15.0001 13.3325 15 13.126L15 12.374C15.0001 12.1675 15.1675 12.0001 15.374 12L16.126 12ZM7.12598 9C7.33249 9.00012 7.49988 9.16751 7.5 9.37402L7.5 10.126C7.49988 10.3325 7.33249 10.4999 7.12598 10.5L6.37402 10.5C6.16751 10.4999 6.00012 10.3325 6 10.126L6 9.37402C6.00012 9.16751 6.16751 9.00012 6.37402 9L7.12598 9ZM10.126 9C10.3325 9.00012 10.4999 9.16751 10.5 9.37402L10.5 10.126C10.4999 10.3325 10.3325 10.4999 10.126 10.5L9.37402 10.5C9.16751 10.4999 9.00012 10.3325 9 10.126L9 9.37402C9.00012 9.16751 9.16751 9.00012 9.37402 9L10.126 9ZM13.126 9C13.3325 9.00012 13.4999 9.16751 13.5 9.37402L13.5 10.126C13.4999 10.3325 13.3325 10.4999 13.126 10.5L12.374 10.5C12.1675 10.4999 12.0001 10.3325 12 10.126L12 9.37402C12.0001 9.16751 12.1675 9.00012 12.374 9L13.126 9ZM16.126 9C16.3325 9.00012 16.4999 9.16751 16.5 9.37402L16.5 10.126C16.4999 10.3325 16.3325 10.4999 16.126 10.5L15.374 10.5C15.1675 10.4999 15.0001 10.3325 15 10.126L15 9.37402C15.0001 9.16751 15.1675 9.00012 15.374 9L16.126 9ZM1.5 6L18 6L18 3L14.25 3L14.25 3.75C14.25 3.94891 14.1709 4.13962 14.0303 4.28027C13.8896 4.42093 13.6989 4.5 13.5 4.5C13.3011 4.5 13.1104 4.42093 12.9697 4.28027C12.8291 4.13962 12.75 3.94891 12.75 3.75L12.75 3L6.75 3L6.75 3.75C6.75 3.94891 6.67093 4.13962 6.53027 4.28027C6.38962 4.42093 6.19891 4.5 6 4.5C5.80109 4.5 5.61038 4.42093 5.46973 4.28027C5.32907 4.13962 5.25 3.94891 5.25 3.75L5.25 3L1.5 3L1.5 6Z"} /><path d={"M18 1.5L14.25 1.5L14.25 0.75C14.25 0.551088 14.171 0.360322 14.0303 0.21967C13.8897 0.0790176 13.6989 6.66134e-16 13.5 0C13.3011 6.66134e-16 13.1103 0.0790176 12.9697 0.21967C12.829 0.360322 12.75 0.551088 12.75 0.75L12.75 1.5L6.75 1.5L6.75 0.75C6.75 0.551088 6.67098 0.360322 6.53033 0.21967C6.38968 0.0790176 6.19891 6.66134e-16 6 0C5.80109 6.66134e-16 5.61032 0.0790176 5.46967 0.21967C5.32902 0.360322 5.25 0.551088 5.25 0.75L5.25 1.5L1.5 1.5C1.10218 1.5 0.720644 1.65804 0.43934 1.93934C0.158035 2.22064 3.33067e-16 2.60218 0 3L0 18C3.33067e-16 18.3978 0.158035 18.7794 0.43934 19.0607C0.720644 19.342 1.10218 19.5 1.5 19.5L18 19.5C18.3978 19.5 18.7794 19.342 19.0607 19.0607C19.342 18.7794 19.5 18.3978 19.5 18L19.5 3C19.5 2.60218 19.342 2.22064 19.0607 1.93934C18.7794 1.65804 18.3978 1.5 18 1.5L18 1.5ZM5.25 3L5.25 3.75C5.25 3.94891 5.32902 4.13968 5.46967 4.28033C5.61032 4.42098 5.80109 4.5 6 4.5C6.19891 4.5 6.38968 4.42098 6.53033 4.28033C6.67098 4.13968 6.75 3.94891 6.75 3.75L6.75 3L12.75 3L12.75 3.75C12.75 3.94891 12.829 4.13968 12.9697 4.28033C13.1103 4.42098 13.3011 4.5 13.5 4.5C13.6989 4.5 13.8897 4.42098 14.0303 4.28033C14.171 4.13968 14.25 3.94891 14.25 3.75L14.25 3L18 3L18 6L1.5 6L1.5 3L5.25 3ZM1.5 18L1.5 7.5L18 7.5L18 18L1.5 18Z"} /><path d={"M1.12575 0L0.37425 0C0.167557 0 0 0.167558 0 0.37425L0 1.12575C0 1.33244 0.167557 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167558 1.33244 0 1.12575 0Z"} /><path d={"M1.12575 0L0.37425 0C0.167558 0 0 0.167558 0 0.37425L0 1.12575C0 1.33244 0.167558 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167558 1.33244 0 1.12575 0Z"} /><path d={"M1.12575 0L0.37425 0C0.167557 0 0 0.167557 0 0.37425L0 1.12575C0 1.33244 0.167557 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167557 1.33244 0 1.12575 0Z"} /><path d={"M1.12575 0L0.37425 0C0.167558 0 0 0.167557 0 0.37425L0 1.12575C0 1.33244 0.167558 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167557 1.33244 0 1.12575 0Z"} /></SvgIcon>
                    {/* @ir:end I1:67438;6585:1197;9445:28917 */}
                  </Stack>
                  {/* @ir:end I1:67438;6585:1197 */}
                </Stack>
                {/* @ir:end I1:67438;6585:1196 */}
                {/* @ir:start I1:67438;9959:72915 <Icon> container */}
                <SvgIcon data-ir-id="I1:67438;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
                {/* @ir:end I1:67438;9959:72915 */}
              </Box>
            </AccordionSummary>
            <AccordionDetails id={"accordion-panel-_accordion__1_67438"} role="region" aria-labelledby={"accordion-header-_accordion__1_67438"} sx={sharedSxStyle19}>
              <Box sx={sharedSxStyle20}>
              {/* @ir:start I1:67438;6585:1196 Content stack */}
              <Stack data-ir-id="I1:67438;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                {/* @ir:start I1:67438;6585:1197 <Stack3>(Nested) stack */}
                <Stack data-ir-id="I1:67438;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                  {/* @ir:start I1:67438;6585:1197;9445:28917 <Icon> container */}
                  <SvgIcon data-ir-id="I1:67438;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M13.5 0C13.6989 0 13.8896 0.0790744 14.0303 0.219727C14.1709 0.360379 14.25 0.551088 14.25 0.75L14.25 1.5L18 1.5C18.3978 1.5 18.7792 1.65815 19.0605 1.93945C19.3419 2.22076 19.5 2.60218 19.5 3L19.5 18C19.5 18.3978 19.3419 18.7792 19.0605 19.0605C18.7792 19.3419 18.3978 19.5 18 19.5L1.5 19.5C1.10218 19.5 0.720758 19.3419 0.439453 19.0605C0.158149 18.7792 0 18.3978 0 18L0 3C0 2.60218 0.158149 2.22076 0.439453 1.93945C0.720758 1.65815 1.10218 1.5 1.5 1.5L5.25 1.5L5.25 0.75C5.25 0.551088 5.32907 0.360379 5.46973 0.219727C5.61038 0.0790743 5.80109 0 6 0C6.19891 0 6.38962 0.0790743 6.53027 0.219727C6.67093 0.360379 6.75 0.551088 6.75 0.75L6.75 1.5L12.75 1.5L12.75 0.75C12.75 0.551088 12.8291 0.360379 12.9697 0.219727C13.1104 0.0790744 13.3011 0 13.5 0ZM1.5 18L18 18L18 7.5L1.5 7.5L1.5 18ZM4.12598 15C4.33249 15.0001 4.49988 15.1675 4.5 15.374L4.5 16.126C4.49988 16.3325 4.33249 16.4999 4.12598 16.5L3.37402 16.5C3.16751 16.4999 3.00012 16.3325 3 16.126L3 15.374C3.00012 15.1675 3.16751 15.0001 3.37402 15L4.12598 15ZM7.12598 15C7.33249 15.0001 7.49988 15.1675 7.5 15.374L7.5 16.126C7.49988 16.3325 7.33249 16.4999 7.12598 16.5L6.37402 16.5C6.16751 16.4999 6.00012 16.3325 6 16.126L6 15.374C6.00012 15.1675 6.16751 15.0001 6.37402 15L7.12598 15ZM10.126 15C10.3325 15.0001 10.4999 15.1675 10.5 15.374L10.5 16.126C10.4999 16.3325 10.3325 16.4999 10.126 16.5L9.37402 16.5C9.16751 16.4999 9.00012 16.3325 9 16.126L9 15.374C9.00012 15.1675 9.16751 15.0001 9.37402 15L10.126 15ZM13.126 15C13.3325 15.0001 13.4999 15.1675 13.5 15.374L13.5 16.126C13.4999 16.3325 13.3325 16.4999 13.126 16.5L12.374 16.5C12.1675 16.4999 12.0001 16.3325 12 16.126L12 15.374C12.0001 15.1675 12.1675 15.0001 12.374 15L13.126 15ZM4.12598 12C4.33249 12.0001 4.49988 12.1675 4.5 12.374L4.5 13.126C4.49988 13.3325 4.33249 13.4999 4.12598 13.5L3.37402 13.5C3.16751 13.4999 3.00012 13.3325 3 13.126L3 12.374C3.00012 12.1675 3.16751 12.0001 3.37402 12L4.12598 12ZM7.12598 12C7.33249 12.0001 7.49988 12.1675 7.5 12.374L7.5 13.126C7.49988 13.3325 7.33249 13.4999 7.12598 13.5L6.37402 13.5C6.16751 13.4999 6.00012 13.3325 6 13.126L6 12.374C6.00012 12.1675 6.16751 12.0001 6.37402 12L7.12598 12ZM10.126 12C10.3325 12.0001 10.4999 12.1675 10.5 12.374L10.5 13.126C10.4999 13.3325 10.3325 13.4999 10.126 13.5L9.37402 13.5C9.16751 13.4999 9.00012 13.3325 9 13.126L9 12.374C9.00012 12.1675 9.16751 12.0001 9.37402 12L10.126 12ZM13.126 12C13.3325 12.0001 13.4999 12.1675 13.5 12.374L13.5 13.126C13.4999 13.3325 13.3325 13.4999 13.126 13.5L12.374 13.5C12.1675 13.4999 12.0001 13.3325 12 13.126L12 12.374C12.0001 12.1675 12.1675 12.0001 12.374 12L13.126 12ZM16.126 12C16.3325 12.0001 16.4999 12.1675 16.5 12.374L16.5 13.126C16.4999 13.3325 16.3325 13.4999 16.126 13.5L15.374 13.5C15.1675 13.4999 15.0001 13.3325 15 13.126L15 12.374C15.0001 12.1675 15.1675 12.0001 15.374 12L16.126 12ZM7.12598 9C7.33249 9.00012 7.49988 9.16751 7.5 9.37402L7.5 10.126C7.49988 10.3325 7.33249 10.4999 7.12598 10.5L6.37402 10.5C6.16751 10.4999 6.00012 10.3325 6 10.126L6 9.37402C6.00012 9.16751 6.16751 9.00012 6.37402 9L7.12598 9ZM10.126 9C10.3325 9.00012 10.4999 9.16751 10.5 9.37402L10.5 10.126C10.4999 10.3325 10.3325 10.4999 10.126 10.5L9.37402 10.5C9.16751 10.4999 9.00012 10.3325 9 10.126L9 9.37402C9.00012 9.16751 9.16751 9.00012 9.37402 9L10.126 9ZM13.126 9C13.3325 9.00012 13.4999 9.16751 13.5 9.37402L13.5 10.126C13.4999 10.3325 13.3325 10.4999 13.126 10.5L12.374 10.5C12.1675 10.4999 12.0001 10.3325 12 10.126L12 9.37402C12.0001 9.16751 12.1675 9.00012 12.374 9L13.126 9ZM16.126 9C16.3325 9.00012 16.4999 9.16751 16.5 9.37402L16.5 10.126C16.4999 10.3325 16.3325 10.4999 16.126 10.5L15.374 10.5C15.1675 10.4999 15.0001 10.3325 15 10.126L15 9.37402C15.0001 9.16751 15.1675 9.00012 15.374 9L16.126 9ZM1.5 6L18 6L18 3L14.25 3L14.25 3.75C14.25 3.94891 14.1709 4.13962 14.0303 4.28027C13.8896 4.42093 13.6989 4.5 13.5 4.5C13.3011 4.5 13.1104 4.42093 12.9697 4.28027C12.8291 4.13962 12.75 3.94891 12.75 3.75L12.75 3L6.75 3L6.75 3.75C6.75 3.94891 6.67093 4.13962 6.53027 4.28027C6.38962 4.42093 6.19891 4.5 6 4.5C5.80109 4.5 5.61038 4.42093 5.46973 4.28027C5.32907 4.13962 5.25 3.94891 5.25 3.75L5.25 3L1.5 3L1.5 6Z"} /><path d={"M18 1.5L14.25 1.5L14.25 0.75C14.25 0.551088 14.171 0.360322 14.0303 0.21967C13.8897 0.0790176 13.6989 6.66134e-16 13.5 0C13.3011 6.66134e-16 13.1103 0.0790176 12.9697 0.21967C12.829 0.360322 12.75 0.551088 12.75 0.75L12.75 1.5L6.75 1.5L6.75 0.75C6.75 0.551088 6.67098 0.360322 6.53033 0.21967C6.38968 0.0790176 6.19891 6.66134e-16 6 0C5.80109 6.66134e-16 5.61032 0.0790176 5.46967 0.21967C5.32902 0.360322 5.25 0.551088 5.25 0.75L5.25 1.5L1.5 1.5C1.10218 1.5 0.720644 1.65804 0.43934 1.93934C0.158035 2.22064 3.33067e-16 2.60218 0 3L0 18C3.33067e-16 18.3978 0.158035 18.7794 0.43934 19.0607C0.720644 19.342 1.10218 19.5 1.5 19.5L18 19.5C18.3978 19.5 18.7794 19.342 19.0607 19.0607C19.342 18.7794 19.5 18.3978 19.5 18L19.5 3C19.5 2.60218 19.342 2.22064 19.0607 1.93934C18.7794 1.65804 18.3978 1.5 18 1.5L18 1.5ZM5.25 3L5.25 3.75C5.25 3.94891 5.32902 4.13968 5.46967 4.28033C5.61032 4.42098 5.80109 4.5 6 4.5C6.19891 4.5 6.38968 4.42098 6.53033 4.28033C6.67098 4.13968 6.75 3.94891 6.75 3.75L6.75 3L12.75 3L12.75 3.75C12.75 3.94891 12.829 4.13968 12.9697 4.28033C13.1103 4.42098 13.3011 4.5 13.5 4.5C13.6989 4.5 13.8897 4.42098 14.0303 4.28033C14.171 4.13968 14.25 3.94891 14.25 3.75L14.25 3L18 3L18 6L1.5 6L1.5 3L5.25 3ZM1.5 18L1.5 7.5L18 7.5L18 18L1.5 18Z"} /><path d={"M1.12575 0L0.37425 0C0.167557 0 0 0.167558 0 0.37425L0 1.12575C0 1.33244 0.167557 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167558 1.33244 0 1.12575 0Z"} /><path d={"M1.12575 0L0.37425 0C0.167558 0 0 0.167558 0 0.37425L0 1.12575C0 1.33244 0.167558 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167558 1.33244 0 1.12575 0Z"} /><path d={"M1.12575 0L0.37425 0C0.167557 0 0 0.167557 0 0.37425L0 1.12575C0 1.33244 0.167557 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167557 1.33244 0 1.12575 0Z"} /><path d={"M1.12575 0L0.37425 0C0.167558 0 0 0.167557 0 0.37425L0 1.12575C0 1.33244 0.167558 1.5 0.37425 1.5L1.12575 1.5C1.33244 1.5 1.5 1.33244 1.5 1.12575L1.5 0.37425C1.5 0.167557 1.33244 0 1.12575 0Z"} /></SvgIcon>
                  {/* @ir:end I1:67438;6585:1197;9445:28917 */}
                </Stack>
                {/* @ir:end I1:67438;6585:1197 */}
              </Stack>
              {/* @ir:end I1:67438;6585:1196 */}
              {/* @ir:start I1:67438;9959:72915 <Icon> container */}
              <SvgIcon data-ir-id="I1:67438;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
              {/* @ir:end I1:67438;9959:72915 */}
              </Box>
            </AccordionDetails>
          </Accordion>
          {/* @ir:end 1:67438 */}
          {/* @ir:start 1:67439 <Divider> divider */}
          <Divider data-ir-id="1:67439" data-ir-name="<Divider>" aria-hidden="true" sx={sharedSxStyle1} />
          {/* @ir:end 1:67439 */}
          {/* @ir:start 1:67440 <Accordion> accordion */}
          <Accordion data-ir-id="1:67440" data-ir-name="<Accordion>"
            expanded={accordionState["_accordion__1_67440"] ?? true}
            onChange={(_, expanded) => updateAccordionState("_accordion__1_67440", expanded)}
            disableGutters
            elevation={0}
            square
            sx={sharedSxStyle12}
          >
            <AccordionSummary id={"accordion-header-_accordion__1_67440"} aria-controls={"accordion-panel-_accordion__1_67440"} expandIcon={<ExpandMoreIcon fontSize="small" />} sx={sharedSxStyle13}>
              <Box sx={sharedSxStyle14}>
                {/* @ir:start I1:67440;6585:1196 Content stack */}
                <Stack data-ir-id="I1:67440;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                  {/* @ir:start I1:67440;6585:1197 <Stack3>(Nested) stack */}
                  <Stack data-ir-id="I1:67440;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                    {/* @ir:start I1:67440;6585:1197;9445:28917 <Icon> container */}
                    <SvgIcon data-ir-id="I1:67440;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M20.2508 17.9992L19.2967 17.9992L19.2967 0.742776C19.2967 0.545779 19.2185 0.356851 19.0794 0.217554C18.9402 0.0782564 18.7515 0 18.5547 0C18.3579 0 18.1692 0.0782564 18.03 0.217554C17.8909 0.356851 17.8127 0.545779 17.8127 0.742776L17.8127 3.36875L12.5582 3.36875C12.4824 3.10603 12.3233 2.87508 12.105 2.71071C11.8867 2.54635 11.6209 2.45747 11.3478 2.45747C11.0746 2.45747 10.8088 2.54635 10.5905 2.71071C10.3722 2.87508 10.2132 3.10603 10.1374 3.36875L10.0145 3.36875C9.93867 3.10603 9.77963 2.87508 9.56131 2.71071C9.34299 2.54635 9.07723 2.45747 8.80406 2.45747C8.53089 2.45747 8.26513 2.54635 8.04681 2.71071C7.82849 2.87508 7.66945 3.10603 7.59366 3.36875L7.4715 3.36875C7.39546 3.10615 7.23629 2.87537 7.01793 2.71114C6.79957 2.54692 6.53384 2.45812 6.26072 2.45812C5.98761 2.45812 5.72188 2.54692 5.50352 2.71114C5.28516 2.87537 5.12599 3.10615 5.04995 3.36875L3.18751 3.36875L3.18751 0.742776C3.18751 0.545779 3.10934 0.356851 2.97019 0.217554C2.83104 0.0782564 2.64232 0 2.44553 0C2.24875 0 2.06002 0.0782564 1.92087 0.217554C1.78172 0.356851 1.70355 0.545779 1.70355 0.742776L1.70355 17.9992L0.749473 17.9992C0.5507 17.9992 0.360069 18.0782 0.219516 18.2189C0.0789621 18.3596 4.99249e-16 18.5505 0 18.7495C3.32833e-16 18.9484 0.0789621 19.1393 0.219516 19.28C0.360069 19.4207 0.5507 19.4997 0.749473 19.4997L20.2508 19.4997C20.4495 19.4997 20.6402 19.4207 20.7807 19.28C20.9213 19.1393 21.0002 18.9484 21.0002 18.7495C21.0002 18.5505 20.9213 18.3596 20.7807 18.2189C20.6402 18.0782 20.4495 17.9992 20.2508 17.9992L20.2508 17.9992ZM15.9503 11.9437C15.8742 11.6811 15.7151 11.4503 15.4967 11.2861C15.2784 11.1218 15.0126 11.0331 14.7395 11.0331C14.4664 11.0331 14.2007 11.1218 13.9823 11.2861C13.7639 11.4503 13.6048 11.6811 13.5287 11.9437L13.4066 11.9437C13.3308 11.681 13.1717 11.45 12.9534 11.2856C12.7351 11.1213 12.4693 11.0324 12.1962 11.0324C11.923 11.0324 11.6572 11.1213 11.4389 11.2856C11.2206 11.45 11.0616 11.681 10.9858 11.9437L7.4715 11.9437C7.39546 11.6811 7.23629 11.4503 7.01793 11.2861C6.79957 11.1218 6.53384 11.0331 6.26072 11.0331C5.98761 11.0331 5.72188 11.1218 5.50352 11.2861C5.28516 11.4503 5.12599 11.6811 5.04995 11.9437L3.18751 11.9437L3.18751 8.40612L5.0507 8.40612C5.12649 8.66884 5.28553 8.89979 5.50385 9.06416C5.72216 9.22852 5.98793 9.3174 6.2611 9.3174C6.53427 9.3174 6.80003 9.22852 7.01835 9.06416C7.23667 8.89979 7.3957 8.66884 7.4715 8.40612L7.59366 8.40612C7.66945 8.66884 7.82849 8.89979 8.04681 9.06416C8.26513 9.22852 8.53089 9.3174 8.80406 9.3174C9.07723 9.3174 9.34299 9.22852 9.56131 9.06416C9.77963 8.89979 9.93867 8.66884 10.0145 8.40612L13.5287 8.40612C13.6045 8.66884 13.7636 8.89979 13.9819 9.06416C14.2002 9.22852 14.466 9.3174 14.7391 9.3174C15.0123 9.3174 15.2781 9.22852 15.4964 9.06416C15.7147 8.89979 15.8737 8.66884 15.9495 8.40612L17.8127 8.40612L17.8127 11.9437L15.9503 11.9437ZM5.04995 4.11903C5.12599 4.38163 5.28516 4.61241 5.50352 4.77664C5.72188 4.94086 5.98761 5.02966 6.26072 5.02966C6.53384 5.02966 6.79957 4.94086 7.01793 4.77664C7.23629 4.61241 7.39546 4.38163 7.4715 4.11903L7.59366 4.11903C7.66945 4.38175 7.82849 4.6127 8.04681 4.77707C8.26513 4.94143 8.53089 5.03031 8.80406 5.03031C9.07723 5.03031 9.34299 4.94143 9.56131 4.77707C9.77963 4.6127 9.93867 4.38175 10.0145 4.11903L10.1374 4.11903C10.2132 4.38175 10.3722 4.6127 10.5905 4.77707C10.8088 4.94143 11.0746 5.03031 11.3478 5.03031C11.6209 5.03031 11.8867 4.94143 12.105 4.77707C12.3233 4.6127 12.4824 4.38175 12.5582 4.11903L17.8127 4.11903L17.8127 7.65584L15.9503 7.65584C15.8742 7.39324 15.7151 7.16246 15.4967 6.99823C15.2784 6.83401 15.0126 6.74521 14.7395 6.74521C14.4664 6.74521 14.2007 6.83401 13.9823 6.99823C13.7639 7.16246 13.6048 7.39324 13.5287 7.65584L10.0145 7.65584C9.93867 7.39312 9.77963 7.16217 9.56131 6.9978C9.34299 6.83344 9.07723 6.74456 8.80406 6.74456C8.53089 6.74456 8.26513 6.83344 8.04681 6.9978C7.82849 7.16217 7.66945 7.39312 7.59366 7.65584L7.4715 7.65584C7.39546 7.39324 7.23629 7.16246 7.01793 6.99823C6.79957 6.83401 6.53384 6.74521 6.26072 6.74521C5.98761 6.74521 5.72188 6.83401 5.50352 6.99823C5.28516 7.16246 5.12599 7.39324 5.04995 7.65584L3.18751 7.65584L3.18751 4.11903L5.04995 4.11903ZM3.18751 12.694L5.0507 12.694C5.12649 12.9567 5.28553 13.1876 5.50385 13.352C5.72216 13.5164 5.98793 13.6052 6.2611 13.6052C6.53427 13.6052 6.80003 13.5164 7.01835 13.352C7.23667 13.1876 7.3957 12.9567 7.4715 12.694L10.9858 12.694C11.0616 12.9567 11.2206 13.1876 11.4389 13.352C11.6572 13.5164 11.923 13.6052 12.1962 13.6052C12.4693 13.6052 12.7351 13.5164 12.9534 13.352C13.1717 13.1876 13.3308 12.9567 13.4066 12.694L13.5287 12.694C13.6045 12.9567 13.7636 13.1876 13.9819 13.352C14.2002 13.5164 14.466 13.6052 14.7391 13.6052C15.0123 13.6052 15.2781 13.5164 15.4964 13.352C15.7147 13.1876 15.8737 12.9567 15.9495 12.694L17.8127 12.694L17.8127 17.9992L3.18751 17.9992L3.18751 12.694Z"} /></SvgIcon>
                    {/* @ir:end I1:67440;6585:1197;9445:28917 */}
                  </Stack>
                  {/* @ir:end I1:67440;6585:1197 */}
                </Stack>
                {/* @ir:end I1:67440;6585:1196 */}
                {/* @ir:start I1:67440;9959:72915 <Icon> container */}
                <SvgIcon data-ir-id="I1:67440;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
                {/* @ir:end I1:67440;9959:72915 */}
              </Box>
            </AccordionSummary>
            <AccordionDetails id={"accordion-panel-_accordion__1_67440"} role="region" aria-labelledby={"accordion-header-_accordion__1_67440"} sx={sharedSxStyle19}>
              <Box sx={sharedSxStyle20}>
              {/* @ir:start I1:67440;6585:1196 Content stack */}
              <Stack data-ir-id="I1:67440;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                {/* @ir:start I1:67440;6585:1197 <Stack3>(Nested) stack */}
                <Stack data-ir-id="I1:67440;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                  {/* @ir:start I1:67440;6585:1197;9445:28917 <Icon> container */}
                  <SvgIcon data-ir-id="I1:67440;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M20.2508 17.9992L19.2967 17.9992L19.2967 0.742776C19.2967 0.545779 19.2185 0.356851 19.0794 0.217554C18.9402 0.0782564 18.7515 0 18.5547 0C18.3579 0 18.1692 0.0782564 18.03 0.217554C17.8909 0.356851 17.8127 0.545779 17.8127 0.742776L17.8127 3.36875L12.5582 3.36875C12.4824 3.10603 12.3233 2.87508 12.105 2.71071C11.8867 2.54635 11.6209 2.45747 11.3478 2.45747C11.0746 2.45747 10.8088 2.54635 10.5905 2.71071C10.3722 2.87508 10.2132 3.10603 10.1374 3.36875L10.0145 3.36875C9.93867 3.10603 9.77963 2.87508 9.56131 2.71071C9.34299 2.54635 9.07723 2.45747 8.80406 2.45747C8.53089 2.45747 8.26513 2.54635 8.04681 2.71071C7.82849 2.87508 7.66945 3.10603 7.59366 3.36875L7.4715 3.36875C7.39546 3.10615 7.23629 2.87537 7.01793 2.71114C6.79957 2.54692 6.53384 2.45812 6.26072 2.45812C5.98761 2.45812 5.72188 2.54692 5.50352 2.71114C5.28516 2.87537 5.12599 3.10615 5.04995 3.36875L3.18751 3.36875L3.18751 0.742776C3.18751 0.545779 3.10934 0.356851 2.97019 0.217554C2.83104 0.0782564 2.64232 0 2.44553 0C2.24875 0 2.06002 0.0782564 1.92087 0.217554C1.78172 0.356851 1.70355 0.545779 1.70355 0.742776L1.70355 17.9992L0.749473 17.9992C0.5507 17.9992 0.360069 18.0782 0.219516 18.2189C0.0789621 18.3596 4.99249e-16 18.5505 0 18.7495C3.32833e-16 18.9484 0.0789621 19.1393 0.219516 19.28C0.360069 19.4207 0.5507 19.4997 0.749473 19.4997L20.2508 19.4997C20.4495 19.4997 20.6402 19.4207 20.7807 19.28C20.9213 19.1393 21.0002 18.9484 21.0002 18.7495C21.0002 18.5505 20.9213 18.3596 20.7807 18.2189C20.6402 18.0782 20.4495 17.9992 20.2508 17.9992L20.2508 17.9992ZM15.9503 11.9437C15.8742 11.6811 15.7151 11.4503 15.4967 11.2861C15.2784 11.1218 15.0126 11.0331 14.7395 11.0331C14.4664 11.0331 14.2007 11.1218 13.9823 11.2861C13.7639 11.4503 13.6048 11.6811 13.5287 11.9437L13.4066 11.9437C13.3308 11.681 13.1717 11.45 12.9534 11.2856C12.7351 11.1213 12.4693 11.0324 12.1962 11.0324C11.923 11.0324 11.6572 11.1213 11.4389 11.2856C11.2206 11.45 11.0616 11.681 10.9858 11.9437L7.4715 11.9437C7.39546 11.6811 7.23629 11.4503 7.01793 11.2861C6.79957 11.1218 6.53384 11.0331 6.26072 11.0331C5.98761 11.0331 5.72188 11.1218 5.50352 11.2861C5.28516 11.4503 5.12599 11.6811 5.04995 11.9437L3.18751 11.9437L3.18751 8.40612L5.0507 8.40612C5.12649 8.66884 5.28553 8.89979 5.50385 9.06416C5.72216 9.22852 5.98793 9.3174 6.2611 9.3174C6.53427 9.3174 6.80003 9.22852 7.01835 9.06416C7.23667 8.89979 7.3957 8.66884 7.4715 8.40612L7.59366 8.40612C7.66945 8.66884 7.82849 8.89979 8.04681 9.06416C8.26513 9.22852 8.53089 9.3174 8.80406 9.3174C9.07723 9.3174 9.34299 9.22852 9.56131 9.06416C9.77963 8.89979 9.93867 8.66884 10.0145 8.40612L13.5287 8.40612C13.6045 8.66884 13.7636 8.89979 13.9819 9.06416C14.2002 9.22852 14.466 9.3174 14.7391 9.3174C15.0123 9.3174 15.2781 9.22852 15.4964 9.06416C15.7147 8.89979 15.8737 8.66884 15.9495 8.40612L17.8127 8.40612L17.8127 11.9437L15.9503 11.9437ZM5.04995 4.11903C5.12599 4.38163 5.28516 4.61241 5.50352 4.77664C5.72188 4.94086 5.98761 5.02966 6.26072 5.02966C6.53384 5.02966 6.79957 4.94086 7.01793 4.77664C7.23629 4.61241 7.39546 4.38163 7.4715 4.11903L7.59366 4.11903C7.66945 4.38175 7.82849 4.6127 8.04681 4.77707C8.26513 4.94143 8.53089 5.03031 8.80406 5.03031C9.07723 5.03031 9.34299 4.94143 9.56131 4.77707C9.77963 4.6127 9.93867 4.38175 10.0145 4.11903L10.1374 4.11903C10.2132 4.38175 10.3722 4.6127 10.5905 4.77707C10.8088 4.94143 11.0746 5.03031 11.3478 5.03031C11.6209 5.03031 11.8867 4.94143 12.105 4.77707C12.3233 4.6127 12.4824 4.38175 12.5582 4.11903L17.8127 4.11903L17.8127 7.65584L15.9503 7.65584C15.8742 7.39324 15.7151 7.16246 15.4967 6.99823C15.2784 6.83401 15.0126 6.74521 14.7395 6.74521C14.4664 6.74521 14.2007 6.83401 13.9823 6.99823C13.7639 7.16246 13.6048 7.39324 13.5287 7.65584L10.0145 7.65584C9.93867 7.39312 9.77963 7.16217 9.56131 6.9978C9.34299 6.83344 9.07723 6.74456 8.80406 6.74456C8.53089 6.74456 8.26513 6.83344 8.04681 6.9978C7.82849 7.16217 7.66945 7.39312 7.59366 7.65584L7.4715 7.65584C7.39546 7.39324 7.23629 7.16246 7.01793 6.99823C6.79957 6.83401 6.53384 6.74521 6.26072 6.74521C5.98761 6.74521 5.72188 6.83401 5.50352 6.99823C5.28516 7.16246 5.12599 7.39324 5.04995 7.65584L3.18751 7.65584L3.18751 4.11903L5.04995 4.11903ZM3.18751 12.694L5.0507 12.694C5.12649 12.9567 5.28553 13.1876 5.50385 13.352C5.72216 13.5164 5.98793 13.6052 6.2611 13.6052C6.53427 13.6052 6.80003 13.5164 7.01835 13.352C7.23667 13.1876 7.3957 12.9567 7.4715 12.694L10.9858 12.694C11.0616 12.9567 11.2206 13.1876 11.4389 13.352C11.6572 13.5164 11.923 13.6052 12.1962 13.6052C12.4693 13.6052 12.7351 13.5164 12.9534 13.352C13.1717 13.1876 13.3308 12.9567 13.4066 12.694L13.5287 12.694C13.6045 12.9567 13.7636 13.1876 13.9819 13.352C14.2002 13.5164 14.466 13.6052 14.7391 13.6052C15.0123 13.6052 15.2781 13.5164 15.4964 13.352C15.7147 13.1876 15.8737 12.9567 15.9495 12.694L17.8127 12.694L17.8127 17.9992L3.18751 17.9992L3.18751 12.694Z"} /></SvgIcon>
                  {/* @ir:end I1:67440;6585:1197;9445:28917 */}
                </Stack>
                {/* @ir:end I1:67440;6585:1197 */}
              </Stack>
              {/* @ir:end I1:67440;6585:1196 */}
              {/* @ir:start I1:67440;9959:72915 <Icon> container */}
              <SvgIcon data-ir-id="I1:67440;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
              {/* @ir:end I1:67440;9959:72915 */}
              </Box>
            </AccordionDetails>
          </Accordion>
          {/* @ir:end 1:67440 */}
          {/* @ir:start 1:67441 <Divider> divider */}
          <Divider data-ir-id="1:67441" data-ir-name="<Divider>" aria-hidden="true" sx={sharedSxStyle1} />
          {/* @ir:end 1:67441 */}
          {/* @ir:start 1:67442 <Accordion> accordion */}
          <Accordion data-ir-id="1:67442" data-ir-name="<Accordion>"
            expanded={accordionState["_accordion__1_67442"] ?? true}
            onChange={(_, expanded) => updateAccordionState("_accordion__1_67442", expanded)}
            disableGutters
            elevation={0}
            square
            sx={sharedSxStyle12}
          >
            <AccordionSummary id={"accordion-header-_accordion__1_67442"} aria-controls={"accordion-panel-_accordion__1_67442"} expandIcon={<ExpandMoreIcon fontSize="small" />} sx={sharedSxStyle13}>
              <Box sx={sharedSxStyle14}>
                {/* @ir:start I1:67442;6585:1196 Content stack */}
                <Stack data-ir-id="I1:67442;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                  {/* @ir:start I1:67442;6585:1197 <Stack3>(Nested) stack */}
                  <Stack data-ir-id="I1:67442;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                    {/* @ir:start I1:67442;6585:1197;9445:28917 <Icon> container */}
                    <SvgIcon data-ir-id="I1:67442;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M18 10.4937C17.0925 10.6137 16.2225 10.8912 15.4125 11.3187C15.39 11.3337 15.3675 11.3487 15.345 11.3712C14.88 10.8312 14.205 10.5087 13.4925 10.4937C12.84 10.5837 12.21 10.7937 11.64 11.1162C10.815 11.5587 9.9225 11.8587 8.9925 11.9937C8.4525 11.9337 7.95 11.7162 7.5375 11.3712C7.0725 11.0262 6.5475 10.7637 5.9925 10.5912L5.9925 10.4937C5.9925 9.66868 5.3175 8.99368 4.4925 8.99368L1.5 8.99368C0.675 8.99368 0 9.66868 0 10.4937L0 18.7437C0 19.5687 0.675 20.2437 1.5 20.2437L4.5 20.2437C5.325 20.2437 6 19.5687 6 18.7437L6 18.1437C6.3975 18.2937 6.7875 18.4662 7.1625 18.6612C7.95 19.1337 8.835 19.4187 9.75 19.4937C10.9575 19.4937 14.76 17.6412 15.9 17.0712C21 14.5212 21 13.9287 21 13.4937C21.1575 11.9937 20.07 10.6512 18.57 10.4937C18.3825 10.4712 18.1875 10.4712 18 10.4937ZM1.5 18.7437L1.5 10.4937L4.5 10.4937L4.5 18.7437L1.5 18.7437ZM9.75 17.9937C9.0675 17.9112 8.415 17.6787 7.8375 17.3187C7.26 17.0037 6.6375 16.7562 6 16.5837L6 12.1887C6.2475 12.3162 6.48 12.4587 6.705 12.6162C7.3575 13.1412 8.16 13.4487 9 13.4937C10.14 13.3737 11.25 13.0287 12.2625 12.4887C12.66 12.2862 13.0725 12.1212 13.5 11.9937C14.0625 11.9937 14.5275 12.6837 14.7525 13.1037L10.2 15.0537C9.8175 15.2187 9.645 15.6612 9.81 16.0362C9.93 16.3137 10.2 16.4937 10.5 16.4937C10.605 16.4937 10.7025 16.4712 10.7925 16.4337L15.345 14.4837C15.735 14.3187 16.035 13.9962 16.17 13.5987C16.275 13.2837 16.275 12.9387 16.17 12.6237C16.7475 12.3237 17.3625 12.1137 18 11.9937C19.005 11.9937 19.44 12.3537 19.4925 13.2762C18.3075 14.3712 10.875 17.9937 9.75 17.9937ZM15.4575 0.548677L15.4575 0.518677C15.4575 0.518677 15.42 0.436177 15.39 0.391177C15.375 0.353677 15.3525 0.316177 15.315 0.278677C15.285 0.248677 15.2475 0.203677 15.24 0.203677C15.2025 0.173677 15.1725 0.143677 15.105 0.106177C15.0825 0.106177 15.0525 0.0836766 15.0225 0.0761766C14.985 0.0611766 14.9325 0.0461766 14.8425 0.0311766C12.6525 -0.201323 9.4575 0.878676 8.1975 2.86618C7.695 3.66118 7.26 4.95118 8.04 6.60868L7.0875 7.58368C6.825 7.85368 6.825 8.28868 7.08 8.55868L7.095 8.57368C7.23 8.70868 7.4025 8.77618 7.59 8.77618C7.7775 8.77618 7.95 8.70118 8.085 8.56618L9.015 7.61368C10.44 8.34868 11.8275 8.28118 13.035 7.40368C15.0075 5.95618 15.9525 2.52868 15.45 0.548677L15.4575 0.548677ZM11.9925 2.56618L9.1125 5.51368C8.9325 4.87618 9.03 4.18618 9.3825 3.61618C10.2525 2.25118 12.51 1.41868 14.175 1.40368C14.31 2.95618 13.5525 5.28118 12.21 6.26368C11.58 6.73618 10.77 6.84118 10.05 6.55618L12.99 3.54868C13.1175 3.41368 13.1925 3.24118 13.1925 3.05368C13.1925 2.86618 13.1175 2.69368 12.9825 2.55868C12.8475 2.42368 12.675 2.35618 12.495 2.35618C12.315 2.35618 12.1275 2.43118 11.9925 2.56618Z"} /></SvgIcon>
                    {/* @ir:end I1:67442;6585:1197;9445:28917 */}
                  </Stack>
                  {/* @ir:end I1:67442;6585:1197 */}
                </Stack>
                {/* @ir:end I1:67442;6585:1196 */}
                {/* @ir:start I1:67442;9959:72915 <Icon> container */}
                <SvgIcon data-ir-id="I1:67442;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
                {/* @ir:end I1:67442;9959:72915 */}
              </Box>
            </AccordionSummary>
            <AccordionDetails id={"accordion-panel-_accordion__1_67442"} role="region" aria-labelledby={"accordion-header-_accordion__1_67442"} sx={sharedSxStyle19}>
              <Box sx={sharedSxStyle20}>
              {/* @ir:start I1:67442;6585:1196 Content stack */}
              <Stack data-ir-id="I1:67442;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                {/* @ir:start I1:67442;6585:1197 <Stack3>(Nested) stack */}
                <Stack data-ir-id="I1:67442;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                  {/* @ir:start I1:67442;6585:1197;9445:28917 <Icon> container */}
                  <SvgIcon data-ir-id="I1:67442;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M18 10.4937C17.0925 10.6137 16.2225 10.8912 15.4125 11.3187C15.39 11.3337 15.3675 11.3487 15.345 11.3712C14.88 10.8312 14.205 10.5087 13.4925 10.4937C12.84 10.5837 12.21 10.7937 11.64 11.1162C10.815 11.5587 9.9225 11.8587 8.9925 11.9937C8.4525 11.9337 7.95 11.7162 7.5375 11.3712C7.0725 11.0262 6.5475 10.7637 5.9925 10.5912L5.9925 10.4937C5.9925 9.66868 5.3175 8.99368 4.4925 8.99368L1.5 8.99368C0.675 8.99368 0 9.66868 0 10.4937L0 18.7437C0 19.5687 0.675 20.2437 1.5 20.2437L4.5 20.2437C5.325 20.2437 6 19.5687 6 18.7437L6 18.1437C6.3975 18.2937 6.7875 18.4662 7.1625 18.6612C7.95 19.1337 8.835 19.4187 9.75 19.4937C10.9575 19.4937 14.76 17.6412 15.9 17.0712C21 14.5212 21 13.9287 21 13.4937C21.1575 11.9937 20.07 10.6512 18.57 10.4937C18.3825 10.4712 18.1875 10.4712 18 10.4937ZM1.5 18.7437L1.5 10.4937L4.5 10.4937L4.5 18.7437L1.5 18.7437ZM9.75 17.9937C9.0675 17.9112 8.415 17.6787 7.8375 17.3187C7.26 17.0037 6.6375 16.7562 6 16.5837L6 12.1887C6.2475 12.3162 6.48 12.4587 6.705 12.6162C7.3575 13.1412 8.16 13.4487 9 13.4937C10.14 13.3737 11.25 13.0287 12.2625 12.4887C12.66 12.2862 13.0725 12.1212 13.5 11.9937C14.0625 11.9937 14.5275 12.6837 14.7525 13.1037L10.2 15.0537C9.8175 15.2187 9.645 15.6612 9.81 16.0362C9.93 16.3137 10.2 16.4937 10.5 16.4937C10.605 16.4937 10.7025 16.4712 10.7925 16.4337L15.345 14.4837C15.735 14.3187 16.035 13.9962 16.17 13.5987C16.275 13.2837 16.275 12.9387 16.17 12.6237C16.7475 12.3237 17.3625 12.1137 18 11.9937C19.005 11.9937 19.44 12.3537 19.4925 13.2762C18.3075 14.3712 10.875 17.9937 9.75 17.9937ZM15.4575 0.548677L15.4575 0.518677C15.4575 0.518677 15.42 0.436177 15.39 0.391177C15.375 0.353677 15.3525 0.316177 15.315 0.278677C15.285 0.248677 15.2475 0.203677 15.24 0.203677C15.2025 0.173677 15.1725 0.143677 15.105 0.106177C15.0825 0.106177 15.0525 0.0836766 15.0225 0.0761766C14.985 0.0611766 14.9325 0.0461766 14.8425 0.0311766C12.6525 -0.201323 9.4575 0.878676 8.1975 2.86618C7.695 3.66118 7.26 4.95118 8.04 6.60868L7.0875 7.58368C6.825 7.85368 6.825 8.28868 7.08 8.55868L7.095 8.57368C7.23 8.70868 7.4025 8.77618 7.59 8.77618C7.7775 8.77618 7.95 8.70118 8.085 8.56618L9.015 7.61368C10.44 8.34868 11.8275 8.28118 13.035 7.40368C15.0075 5.95618 15.9525 2.52868 15.45 0.548677L15.4575 0.548677ZM11.9925 2.56618L9.1125 5.51368C8.9325 4.87618 9.03 4.18618 9.3825 3.61618C10.2525 2.25118 12.51 1.41868 14.175 1.40368C14.31 2.95618 13.5525 5.28118 12.21 6.26368C11.58 6.73618 10.77 6.84118 10.05 6.55618L12.99 3.54868C13.1175 3.41368 13.1925 3.24118 13.1925 3.05368C13.1925 2.86618 13.1175 2.69368 12.9825 2.55868C12.8475 2.42368 12.675 2.35618 12.495 2.35618C12.315 2.35618 12.1275 2.43118 11.9925 2.56618Z"} /></SvgIcon>
                  {/* @ir:end I1:67442;6585:1197;9445:28917 */}
                </Stack>
                {/* @ir:end I1:67442;6585:1197 */}
              </Stack>
              {/* @ir:end I1:67442;6585:1196 */}
              {/* @ir:start I1:67442;9959:72915 <Icon> container */}
              <SvgIcon data-ir-id="I1:67442;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
              {/* @ir:end I1:67442;9959:72915 */}
              </Box>
            </AccordionDetails>
          </Accordion>
          {/* @ir:end 1:67442 */}
          {/* @ir:start 1:67443 <Divider> divider */}
          <Divider data-ir-id="1:67443" data-ir-name="<Divider>" aria-hidden="true" sx={sharedSxStyle1} />
          {/* @ir:end 1:67443 */}
          {/* @ir:start 1:67444 <Accordion> accordion */}
          <Accordion data-ir-id="1:67444" data-ir-name="<Accordion>"
            expanded={accordionState["_accordion__1_67444"] ?? true}
            onChange={(_, expanded) => updateAccordionState("_accordion__1_67444", expanded)}
            disableGutters
            elevation={0}
            square
            sx={sharedSxStyle12}
          >
            <AccordionSummary id={"accordion-header-_accordion__1_67444"} aria-controls={"accordion-panel-_accordion__1_67444"} expandIcon={<ExpandMoreIcon fontSize="small" />} sx={sharedSxStyle13}>
              <Box sx={sharedSxStyle14}>
                {/* @ir:start I1:67444;6585:1196 Content stack */}
                <Stack data-ir-id="I1:67444;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                  {/* @ir:start I1:67444;6585:1197 <Stack3>(Nested) stack */}
                  <Stack data-ir-id="I1:67444;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                    {/* @ir:start I1:67444;6585:1197;9445:28917 <Icon> container */}
                    <SvgIcon data-ir-id="I1:67444;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M8.325 20.3813C8.175 20.3813 8.1 20.3813 8.025 20.3063C7.65 20.0813 0 16.2563 0 10.1813L0 3.58126C0.00356123 3.43773 0.0477223 3.29814 0.127366 3.17867C0.20701 3.05921 0.318875 2.96476 0.45 2.90626L8.025 0.056262C8.10754 0.0191751 8.19701 0 8.2875 0C8.37799 0 8.46746 0.0191751 8.55 0.056262L16.125 2.90626C16.2648 2.95205 16.3852 3.04349 16.4668 3.1659C16.5484 3.28831 16.5865 3.43459 16.575 3.58126L16.575 10.1813C16.575 16.2563 8.925 20.0813 8.625 20.3063C8.55 20.3063 8.475 20.3813 8.325 20.3813ZM1.5 4.10626L1.5 10.1813C1.5 14.6813 6.9 17.9813 8.325 18.7313C9.75 17.9063 15.15 14.6063 15.15 10.1813L15.15 4.10626L8.325 1.55626L1.5 4.10626Z"} /></SvgIcon>
                    {/* @ir:end I1:67444;6585:1197;9445:28917 */}
                  </Stack>
                  {/* @ir:end I1:67444;6585:1197 */}
                </Stack>
                {/* @ir:end I1:67444;6585:1196 */}
                {/* @ir:start I1:67444;9959:72915 <Icon> container */}
                <SvgIcon data-ir-id="I1:67444;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
                {/* @ir:end I1:67444;9959:72915 */}
              </Box>
            </AccordionSummary>
            <AccordionDetails id={"accordion-panel-_accordion__1_67444"} role="region" aria-labelledby={"accordion-header-_accordion__1_67444"} sx={sharedSxStyle19}>
              <Box sx={sharedSxStyle20}>
              {/* @ir:start I1:67444;6585:1196 Content stack */}
              <Stack data-ir-id="I1:67444;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                {/* @ir:start I1:67444;6585:1197 <Stack3>(Nested) stack */}
                <Stack data-ir-id="I1:67444;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                  {/* @ir:start I1:67444;6585:1197;9445:28917 <Icon> container */}
                  <SvgIcon data-ir-id="I1:67444;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M8.325 20.3813C8.175 20.3813 8.1 20.3813 8.025 20.3063C7.65 20.0813 0 16.2563 0 10.1813L0 3.58126C0.00356123 3.43773 0.0477223 3.29814 0.127366 3.17867C0.20701 3.05921 0.318875 2.96476 0.45 2.90626L8.025 0.056262C8.10754 0.0191751 8.19701 0 8.2875 0C8.37799 0 8.46746 0.0191751 8.55 0.056262L16.125 2.90626C16.2648 2.95205 16.3852 3.04349 16.4668 3.1659C16.5484 3.28831 16.5865 3.43459 16.575 3.58126L16.575 10.1813C16.575 16.2563 8.925 20.0813 8.625 20.3063C8.55 20.3063 8.475 20.3813 8.325 20.3813ZM1.5 4.10626L1.5 10.1813C1.5 14.6813 6.9 17.9813 8.325 18.7313C9.75 17.9063 15.15 14.6063 15.15 10.1813L15.15 4.10626L8.325 1.55626L1.5 4.10626Z"} /></SvgIcon>
                  {/* @ir:end I1:67444;6585:1197;9445:28917 */}
                </Stack>
                {/* @ir:end I1:67444;6585:1197 */}
              </Stack>
              {/* @ir:end I1:67444;6585:1196 */}
              {/* @ir:start I1:67444;9959:72915 <Icon> container */}
              <SvgIcon data-ir-id="I1:67444;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
              {/* @ir:end I1:67444;9959:72915 */}
              </Box>
            </AccordionDetails>
          </Accordion>
          {/* @ir:end 1:67444 */}
          {/* @ir:start 1:67445 <Divider> divider */}
          <Divider data-ir-id="1:67445" data-ir-name="<Divider>" aria-hidden="true" sx={sharedSxStyle1} />
          {/* @ir:end 1:67445 */}
          {/* @ir:start 1:67446 <Accordion> accordion */}
          <Accordion data-ir-id="1:67446" data-ir-name="<Accordion>"
            expanded={accordionState["_accordion__1_67446"] ?? true}
            onChange={(_, expanded) => updateAccordionState("_accordion__1_67446", expanded)}
            disableGutters
            elevation={0}
            square
            sx={sharedSxStyle12}
          >
            <AccordionSummary id={"accordion-header-_accordion__1_67446"} aria-controls={"accordion-panel-_accordion__1_67446"} expandIcon={<ExpandMoreIcon fontSize="small" />} sx={sharedSxStyle13}>
              <Box sx={sharedSxStyle14}>
                {/* @ir:start I1:67446;6585:1196 Content stack */}
                <Stack data-ir-id="I1:67446;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                  {/* @ir:start I1:67446;6585:1197 <Stack3>(Nested) stack */}
                  <Stack data-ir-id="I1:67446;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                    {/* @ir:start I1:67446;6585:1197;9445:28917 <Icon> container */}
                    <SvgIcon data-ir-id="I1:67446;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M10.5 0C10.6989 4.24683e-05 10.8897 0.0790647 11.0303 0.219727L16.2803 5.46973C16.4209 5.61035 16.5 5.8011 16.5 6L16.5 19.5C16.5 19.8978 16.3419 20.2792 16.0605 20.5605C15.7792 20.8419 15.3978 21 15 21L1.5 21C1.10218 21 0.720758 20.8419 0.439453 20.5605C0.158149 20.2792 0 19.8978 0 19.5L0 1.5C0 1.10218 0.158149 0.720758 0.439453 0.439453C0.720758 0.158149 1.10218 0 1.5 0L10.5 0ZM1.5 19.5L15 19.5L15 6.75L11.25 6.75C10.8522 6.75 10.4708 6.59185 10.1895 6.31055C9.90815 6.02924 9.75 5.64782 9.75 5.25L9.75 1.5L1.5 1.5L1.5 19.5ZM12 15C12.1989 15 12.3896 15.0791 12.5303 15.2197C12.6709 15.3604 12.75 15.5511 12.75 15.75C12.75 15.9489 12.6709 16.1396 12.5303 16.2803C12.3896 16.4209 12.1989 16.5 12 16.5L4.5 16.5C4.30109 16.5 4.11038 16.4209 3.96973 16.2803C3.82907 16.1396 3.75 15.9489 3.75 15.75C3.75 15.5511 3.82907 15.3604 3.96973 15.2197C4.11038 15.0791 4.30109 15 4.5 15L12 15ZM12 12C12.1989 12 12.3896 12.0791 12.5303 12.2197C12.6709 12.3604 12.75 12.5511 12.75 12.75C12.75 12.9489 12.6709 13.1396 12.5303 13.2803C12.3896 13.4209 12.1989 13.5 12 13.5L4.5 13.5C4.30109 13.5 4.11038 13.4209 3.96973 13.2803C3.82907 13.1396 3.75 12.9489 3.75 12.75C3.75 12.5511 3.82907 12.3604 3.96973 12.2197C4.11038 12.0791 4.30109 12 4.5 12L12 12ZM6.88965 4.06934C7.4307 4.06441 7.96808 4.15939 8.47461 4.34961L8.13965 5.29102C8.03744 5.25215 7.93262 5.22033 7.82617 5.19531C7.5608 5.13313 7.29064 5.09331 7.01855 5.07715C6.69185 5.04411 6.36312 5.12003 6.08398 5.29297C5.80487 5.4659 5.5905 5.72696 5.47461 6.03418L7.83789 6.03418L7.6875 6.54785L5.3623 6.54785C5.34131 6.69197 5.32915 6.83779 5.32617 6.9834C5.32535 7.11633 5.33472 7.24926 5.35352 7.38086L7.36816 7.38086L7.22266 7.89551L5.42871 7.89551C5.44652 8.08006 5.50035 8.2594 5.58789 8.42285C5.67542 8.58628 5.79475 8.73057 5.93848 8.84766C6.08227 8.96474 6.24798 9.05283 6.42578 9.10547C6.60355 9.15806 6.79031 9.17424 6.97461 9.1543C7.38851 9.16214 7.8013 9.10163 8.19531 8.97461L8.52637 9.9248C7.97125 10.0993 7.3934 10.1908 6.81152 10.1963C6.14965 10.2443 5.49531 10.03 4.99023 9.59961C4.48519 9.16908 4.16975 8.55666 4.1123 7.89551L3.27344 7.89551L3.41309 7.38086L4.04395 7.38086C4.03945 7.31786 4.03516 7.25538 4.03516 7.19238L4.03516 6.99609C4.03533 6.84567 4.0442 6.6952 4.0625 6.5459L3.27344 6.5459L3.41309 6.03125L4.1582 6.03125C4.31378 5.43756 4.67151 4.91672 5.16992 4.55859C5.66859 4.20041 6.27712 4.02711 6.88965 4.06934ZM11.25 5.25L13.9395 5.25L11.25 2.56055L11.25 5.25Z"} /><path d={"M8.25 0L0.75 0C0.551088 0 0.360322 0.0790171 0.21967 0.219669C0.0790178 0.360322 0 0.551088 0 0.75C0 0.948912 0.0790178 1.13968 0.21967 1.28033C0.360322 1.42098 0.551088 1.5 0.75 1.5L8.25 1.5C8.44891 1.5 8.63968 1.42098 8.78033 1.28033C8.92098 1.13968 9 0.948912 9 0.75C9 0.551088 8.92098 0.360322 8.78033 0.219669C8.63968 0.0790171 8.44891 0 8.25 0Z"} /><path d={"M16.2803 5.46975L11.0303 0.21975C10.8896 0.079088 10.6989 4.24781e-05 10.5 0L1.5 0C1.10218 3.33067e-16 0.720644 0.158035 0.43934 0.43934C0.158035 0.720644 1.33227e-15 1.10218 0 1.5L0 19.5C6.66134e-16 19.8978 0.158035 20.2794 0.43934 20.5607C0.720644 20.842 1.10218 21 1.5 21L15 21C15.3978 21 15.7794 20.842 16.0607 20.5607C16.342 20.2794 16.5 19.8978 16.5 19.5L16.5 6C16.5 5.8011 16.4209 5.61037 16.2803 5.46975ZM11.25 2.5605L13.9395 5.25L11.25 5.25L11.25 2.5605ZM1.5 19.5L1.5 1.5L9.75 1.5L9.75 5.25C9.75 5.64782 9.90804 6.02936 10.1893 6.31066C10.4706 6.59196 10.8522 6.75 11.25 6.75L15 6.75L15 19.5L1.5 19.5Z"} /><path d={"M0.83925 3.83199L0 3.83199L0.140249 3.31749L0.771 3.31749C0.7665 3.25449 0.762 3.19224 0.762 3.12924L0.762 2.93274C0.762178 2.78232 0.771445 2.63205 0.78975 2.48274L0 2.48274L0.140249 1.96824L0.885 1.96824C1.04058 1.3743 1.39859 0.853294 1.89725 0.495107C2.39592 0.13692 3.00398 -0.0359781 3.6165 0.00624367C4.15776 0.00129393 4.69529 0.0963901 5.202 0.286744L4.86675 1.22799C4.76449 1.1891 4.65976 1.15703 4.55325 1.13199C4.28785 1.0698 4.01761 1.03041 3.7455 1.01424C3.4188 0.981209 3.09034 1.05706 2.8112 1.22999C2.53206 1.40293 2.31789 1.66326 2.202 1.97049L4.5645 1.97049L4.4145 2.48499L2.0895 2.48499C2.0685 2.62911 2.05648 2.77439 2.0535 2.91999C2.05267 3.05298 2.0617 3.18584 2.0805 3.31749L4.095 3.31749L3.9495 3.83199L2.1555 3.83199C2.17328 4.01665 2.22753 4.19594 2.31511 4.35947C2.40269 4.523 2.52186 4.66752 2.66572 4.78465C2.80957 4.90179 2.97524 4.9892 3.15312 5.04183C3.33101 5.09446 3.51757 5.11125 3.702 5.09124C4.1159 5.09909 4.52824 5.03827 4.92225 4.91124L5.25375 5.86149C4.69851 6.03606 4.12051 6.12755 3.5385 6.13299C2.8765 6.181 2.2222 5.96652 1.71709 5.53593C1.21197 5.10534 0.896633 4.49325 0.83925 3.83199L0.83925 3.83199Z"} /></SvgIcon>
                    {/* @ir:end I1:67446;6585:1197;9445:28917 */}
                  </Stack>
                  {/* @ir:end I1:67446;6585:1197 */}
                </Stack>
                {/* @ir:end I1:67446;6585:1196 */}
                {/* @ir:start I1:67446;9959:72915 <Icon> container */}
                <SvgIcon data-ir-id="I1:67446;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
                {/* @ir:end I1:67446;9959:72915 */}
              </Box>
            </AccordionSummary>
            <AccordionDetails id={"accordion-panel-_accordion__1_67446"} role="region" aria-labelledby={"accordion-header-_accordion__1_67446"} sx={sharedSxStyle19}>
              <Box sx={sharedSxStyle20}>
              {/* @ir:start I1:67446;6585:1196 Content stack */}
              <Stack data-ir-id="I1:67446;6585:1196" data-ir-name="Content" component="main" direction="column" spacing={0} role="main" aria-hidden="true" sx={sharedSxStyle15}>
                {/* @ir:start I1:67446;6585:1197 <Stack3>(Nested) stack */}
                <Stack data-ir-id="I1:67446;6585:1197" data-ir-name="<Stack3>(Nested)" direction="row" spacing={0.8} aria-hidden="true" sx={sharedSxStyle16}>
                  {/* @ir:start I1:67446;6585:1197;9445:28917 <Icon> container */}
                  <SvgIcon data-ir-id="I1:67446;6585:1197;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle17} viewBox={"0 0 24 24"}><path d={"M10.5 0C10.6989 4.24683e-05 10.8897 0.0790647 11.0303 0.219727L16.2803 5.46973C16.4209 5.61035 16.5 5.8011 16.5 6L16.5 19.5C16.5 19.8978 16.3419 20.2792 16.0605 20.5605C15.7792 20.8419 15.3978 21 15 21L1.5 21C1.10218 21 0.720758 20.8419 0.439453 20.5605C0.158149 20.2792 0 19.8978 0 19.5L0 1.5C0 1.10218 0.158149 0.720758 0.439453 0.439453C0.720758 0.158149 1.10218 0 1.5 0L10.5 0ZM1.5 19.5L15 19.5L15 6.75L11.25 6.75C10.8522 6.75 10.4708 6.59185 10.1895 6.31055C9.90815 6.02924 9.75 5.64782 9.75 5.25L9.75 1.5L1.5 1.5L1.5 19.5ZM12 15C12.1989 15 12.3896 15.0791 12.5303 15.2197C12.6709 15.3604 12.75 15.5511 12.75 15.75C12.75 15.9489 12.6709 16.1396 12.5303 16.2803C12.3896 16.4209 12.1989 16.5 12 16.5L4.5 16.5C4.30109 16.5 4.11038 16.4209 3.96973 16.2803C3.82907 16.1396 3.75 15.9489 3.75 15.75C3.75 15.5511 3.82907 15.3604 3.96973 15.2197C4.11038 15.0791 4.30109 15 4.5 15L12 15ZM12 12C12.1989 12 12.3896 12.0791 12.5303 12.2197C12.6709 12.3604 12.75 12.5511 12.75 12.75C12.75 12.9489 12.6709 13.1396 12.5303 13.2803C12.3896 13.4209 12.1989 13.5 12 13.5L4.5 13.5C4.30109 13.5 4.11038 13.4209 3.96973 13.2803C3.82907 13.1396 3.75 12.9489 3.75 12.75C3.75 12.5511 3.82907 12.3604 3.96973 12.2197C4.11038 12.0791 4.30109 12 4.5 12L12 12ZM6.88965 4.06934C7.4307 4.06441 7.96808 4.15939 8.47461 4.34961L8.13965 5.29102C8.03744 5.25215 7.93262 5.22033 7.82617 5.19531C7.5608 5.13313 7.29064 5.09331 7.01855 5.07715C6.69185 5.04411 6.36312 5.12003 6.08398 5.29297C5.80487 5.4659 5.5905 5.72696 5.47461 6.03418L7.83789 6.03418L7.6875 6.54785L5.3623 6.54785C5.34131 6.69197 5.32915 6.83779 5.32617 6.9834C5.32535 7.11633 5.33472 7.24926 5.35352 7.38086L7.36816 7.38086L7.22266 7.89551L5.42871 7.89551C5.44652 8.08006 5.50035 8.2594 5.58789 8.42285C5.67542 8.58628 5.79475 8.73057 5.93848 8.84766C6.08227 8.96474 6.24798 9.05283 6.42578 9.10547C6.60355 9.15806 6.79031 9.17424 6.97461 9.1543C7.38851 9.16214 7.8013 9.10163 8.19531 8.97461L8.52637 9.9248C7.97125 10.0993 7.3934 10.1908 6.81152 10.1963C6.14965 10.2443 5.49531 10.03 4.99023 9.59961C4.48519 9.16908 4.16975 8.55666 4.1123 7.89551L3.27344 7.89551L3.41309 7.38086L4.04395 7.38086C4.03945 7.31786 4.03516 7.25538 4.03516 7.19238L4.03516 6.99609C4.03533 6.84567 4.0442 6.6952 4.0625 6.5459L3.27344 6.5459L3.41309 6.03125L4.1582 6.03125C4.31378 5.43756 4.67151 4.91672 5.16992 4.55859C5.66859 4.20041 6.27712 4.02711 6.88965 4.06934ZM11.25 5.25L13.9395 5.25L11.25 2.56055L11.25 5.25Z"} /><path d={"M8.25 0L0.75 0C0.551088 0 0.360322 0.0790171 0.21967 0.219669C0.0790178 0.360322 0 0.551088 0 0.75C0 0.948912 0.0790178 1.13968 0.21967 1.28033C0.360322 1.42098 0.551088 1.5 0.75 1.5L8.25 1.5C8.44891 1.5 8.63968 1.42098 8.78033 1.28033C8.92098 1.13968 9 0.948912 9 0.75C9 0.551088 8.92098 0.360322 8.78033 0.219669C8.63968 0.0790171 8.44891 0 8.25 0Z"} /><path d={"M16.2803 5.46975L11.0303 0.21975C10.8896 0.079088 10.6989 4.24781e-05 10.5 0L1.5 0C1.10218 3.33067e-16 0.720644 0.158035 0.43934 0.43934C0.158035 0.720644 1.33227e-15 1.10218 0 1.5L0 19.5C6.66134e-16 19.8978 0.158035 20.2794 0.43934 20.5607C0.720644 20.842 1.10218 21 1.5 21L15 21C15.3978 21 15.7794 20.842 16.0607 20.5607C16.342 20.2794 16.5 19.8978 16.5 19.5L16.5 6C16.5 5.8011 16.4209 5.61037 16.2803 5.46975ZM11.25 2.5605L13.9395 5.25L11.25 5.25L11.25 2.5605ZM1.5 19.5L1.5 1.5L9.75 1.5L9.75 5.25C9.75 5.64782 9.90804 6.02936 10.1893 6.31066C10.4706 6.59196 10.8522 6.75 11.25 6.75L15 6.75L15 19.5L1.5 19.5Z"} /><path d={"M0.83925 3.83199L0 3.83199L0.140249 3.31749L0.771 3.31749C0.7665 3.25449 0.762 3.19224 0.762 3.12924L0.762 2.93274C0.762178 2.78232 0.771445 2.63205 0.78975 2.48274L0 2.48274L0.140249 1.96824L0.885 1.96824C1.04058 1.3743 1.39859 0.853294 1.89725 0.495107C2.39592 0.13692 3.00398 -0.0359781 3.6165 0.00624367C4.15776 0.00129393 4.69529 0.0963901 5.202 0.286744L4.86675 1.22799C4.76449 1.1891 4.65976 1.15703 4.55325 1.13199C4.28785 1.0698 4.01761 1.03041 3.7455 1.01424C3.4188 0.981209 3.09034 1.05706 2.8112 1.22999C2.53206 1.40293 2.31789 1.66326 2.202 1.97049L4.5645 1.97049L4.4145 2.48499L2.0895 2.48499C2.0685 2.62911 2.05648 2.77439 2.0535 2.91999C2.05267 3.05298 2.0617 3.18584 2.0805 3.31749L4.095 3.31749L3.9495 3.83199L2.1555 3.83199C2.17328 4.01665 2.22753 4.19594 2.31511 4.35947C2.40269 4.523 2.52186 4.66752 2.66572 4.78465C2.80957 4.90179 2.97524 4.9892 3.15312 5.04183C3.33101 5.09446 3.51757 5.11125 3.702 5.09124C4.1159 5.09909 4.52824 5.03827 4.92225 4.91124L5.25375 5.86149C4.69851 6.03606 4.12051 6.12755 3.5385 6.13299C2.8765 6.181 2.2222 5.96652 1.71709 5.53593C1.21197 5.10534 0.896633 4.49325 0.83925 3.83199L0.83925 3.83199Z"} /></SvgIcon>
                  {/* @ir:end I1:67446;6585:1197;9445:28917 */}
                </Stack>
                {/* @ir:end I1:67446;6585:1197 */}
              </Stack>
              {/* @ir:end I1:67446;6585:1196 */}
              {/* @ir:start I1:67446;9959:72915 <Icon> container */}
              <SvgIcon data-ir-id="I1:67446;9959:72915" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle18} viewBox={"0 0 16 16"}><path d={"M3.16614e-07 0.686043C-8.62514e-05 0.776107 0.0175799 0.865304 0.0519889 0.948535C0.0863979 1.03177 0.136875 1.1074 0.200534 1.17111L6.20573 7.17111C6.33447 7.29957 6.5089 7.37172 6.69077 7.37172C6.87263 7.37172 7.04707 7.29957 7.1758 7.17111L13.181 1.17111C13.2447 1.10741 13.2952 1.0318 13.3297 0.948575C13.3642 0.865353 13.3819 0.776156 13.3819 0.686077C13.3819 0.595998 13.3642 0.506801 13.3297 0.423579C13.2952 0.340357 13.2447 0.264739 13.181 0.201043C13.1173 0.137348 13.0417 0.0868219 12.9585 0.0523502C12.8752 0.0178784 12.786 0.000135878 12.696 0.000135878C12.6059 0.000135879 12.5167 0.0178784 12.4335 0.0523502C12.3502 0.0868219 12.2746 0.137348 12.2109 0.201043L6.69093 5.71664L1.17093 0.201043C1.07506 0.105067 0.952862 0.0396943 0.819815 0.0132006C0.686767 -0.0132931 0.54885 0.0002835 0.423522 0.0522119C0.298195 0.10414 0.191091 0.192085 0.115771 0.304915C0.0404505 0.417744 0.000299422 0.550384 0.000400304 0.686043L3.16614e-07 0.686043Z"} /></SvgIcon>
              {/* @ir:end I1:67446;9959:72915 */}
              </Box>
            </AccordionDetails>
          </Accordion>
          {/* @ir:end 1:67446 */}
          {/* @ir:start 1:67447 <Stack2>(Nested) stack */}
          <Stack data-ir-id="1:67447" data-ir-name="<Stack2>(Nested)" direction="column" spacing={0} sx={{ width: "100%", maxWidth: "960px", minHeight: "148px", display: "flex", flexDirection: "column", justifyContent: "center", pt: 3.2, pr: 2, pb: 2, pl: 2 }}>
            {/* @ir:start I1:67447;9445:27734 <TextField> input */}
            <Controller data-ir-id="I1:67447;9445:27734" data-ir-name="<TextField>"
              name={"_textfield__I1_67447_9445_27734"}
              control={control}
              render={({ field: controllerField, fieldState }) => {
                const helperText = resolveFieldErrorMessage({
                  fieldKey: "_textfield__I1_67447_9445_27734",
                  isTouched: fieldState.isTouched,
                  isSubmitted,
                  fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                });
                return (
                  <TextField
                    label={"Interner Vermerk"}
                    value={controllerField.value}
                    onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
                    onBlur={controllerField.onBlur}
                    error={Boolean(helperText)}
                    helperText={helperText}
                    aria-label={"Interner Vermerk"}
                    aria-describedby={"_textfield__I1_67447_9445_27734-helper-text"}
              sx={{
                width: "95.8%", maxWidth: "920px", minHeight: "96px", display: "flex", flexDirection: "column", gap: 0.8,
                "& .MuiOutlinedInput-root": { fontFamily: "Sparkasse Rg, Roboto, Arial, sans-serif", color: "#565656" },
                "& .MuiInputLabel-root": { fontFamily: "Sparkasse Rg, Roboto, Arial, sans-serif", color: "#565656" }
              }}

                    slotProps={{
                      htmlInput: { "aria-describedby": "_textfield__I1_67447_9445_27734-helper-text" },
                formHelperText: { id: "_textfield__I1_67447_9445_27734-helper-text" }
                    }}
                  />
                );
              }}
            />
            {/* @ir:end I1:67447;9445:27734 */}
          </Stack>
          {/* @ir:end 1:67447 */}
        </Stack>
        {/* @ir:end 1:66141 */}
        {/* @ir:start 1:67459 <Stack> ButtonCombination stack */}
        <Stack data-ir-id="1:67459" data-ir-name="<Stack> ButtonCombination" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "960px", minHeight: "68px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", pt: 2 }}>
          {/* @ir:start I1:67459;32:73283 <Stack> stack */}
          <Stack data-ir-id="I1:67459;32:73283" data-ir-name="<Stack>" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "960px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 }}>
            {/* @ir:start I1:67459;32:73283;5213:6559 <Button> button */}
            <Button data-ir-id="I1:67459;32:73283;5213:6559" data-ir-name="<Button>" variant="outlined" color="secondary" size="large" disableElevation type="button" sx={{ width: "41.7%", maxWidth: "400px", minHeight: "48px", display: "flex", flexDirection: "column", alignItems: "center", borderRadius: 8, color: "#565656", justifyContent: "center" }}>{"Abbrechen"}</Button>
            {/* @ir:end I1:67459;32:73283;5213:6559 */}
            {/* @ir:start I1:67459;32:73283;5213:6575 <Button> button */}
            <Button data-ir-id="I1:67459;32:73283;5213:6575" data-ir-name="<Button>" variant="contained" size="large" disabled={isSubmitting} disableElevation type="submit" sx={{ width: "41.7%", maxWidth: "400px", minHeight: "48px", display: "flex", flexDirection: "column", alignItems: "center", bgcolor: "#ee0000", borderRadius: 8, color: "background.default", justifyContent: "center" }}>{"Bedarf anlegen"}</Button>
            {/* @ir:end I1:67459;32:73283;5213:6575 */}
          </Stack>
          {/* @ir:end I1:67459;32:73283 */}
        </Stack>
        {/* @ir:end 1:67459 */}
      </Stack>
      {/* @ir:end 1:66138 */}
    </Container>
  );
}

function BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050Content(props: Readonly<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentProps>) {
  return (
      <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentFormContextProvider initialVisualErrorsOverride={props.initialVisualErrorsOverride} validationMessagesOverride={props.validationMessagesOverride}>
      <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentBody
        screenLevelErrorEvidence={props.screenLevelErrorEvidence}
      />
      </BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050ContentFormContextProvider>
  );
}

function renderVariantContent(
  variantId: BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantId,
  scenario: BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1VariantScenario
) {
  switch (variantId) {
    case "1:63230":
      return (
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:64644":
      return (
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:66050":
      return (
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant2166050Content
          initialVisualErrorsOverride={scenario.initialVisualErrorsOverride}
          validationMessagesOverride={scenario.validationMessagesOverride}
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:67464":
      return (
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    case "1:68884":
      return (
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
    default:
      return (
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Variant1167464Content
          screenLevelErrorEvidence={scenario.screenLevelErrorEvidence}
        />
      );
  }
}

const sharedSxStyle1 = { width: "100%", maxWidth: "960px", minHeight: "1px", display: "flex", flexDirection: "column" };
const sharedSxStyle2 = { height: "24px", color: "#565656", width: "2.5%", maxWidth: "24px", minHeight: "24px", flexDirection: "row", display: "flex", alignItems: "center", justifyContent: "center" };
const sharedSxStyle3 = { width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column" };
const sharedSxStyle4 = { width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column", gap: 0.8, "& .MuiOutlinedInput-root": { fontFamily: "Sparkasse Rg, Roboto, Arial, sans-serif", color: "primary.main" }, "& .MuiInputLabel-root": { fontFamily: "Sparkasse Rg, Roboto, Arial, sans-serif", color: "#565656" } };
const sharedSxStyle5 = { width: "100%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", gap: 0.8, px: 2 };
const sharedSxStyle6 = { width: "100%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" };
const sharedSxStyle7 = { width: "100%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1.6, py: 1.6 };
const sharedSxStyle8 = { width: "54.8%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" };
const sharedSxStyle9 = { width: "100%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" };
const sharedSxStyle10 = { width: "100%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1.6, py: 1.6 };
const sharedSxStyle11 = { width: "44.4%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" };
const sharedSxStyle12 = { width: "100%", maxWidth: "960px", minHeight: "60px", display: "flex", flexDirection: "column", boxShadow: "none", "&::before": { display: "none" } };
const sharedSxStyle13 = { minHeight: "60px", py: 1.6, px: 2 };
const sharedSxStyle14 = { width: "100%", position: "relative", minHeight: "60px" };
const sharedSxStyle15 = { width: "92.9%", maxWidth: "892px", minHeight: "28px", display: "flex", flexDirection: "column", justifyContent: "center" };
const sharedSxStyle16 = { width: "100%", maxWidth: "892px", minHeight: "28px", display: "flex", flexDirection: "row", alignItems: "center", gap: 0.8 };
const sharedSxStyle17 = { height: "24px", color: "#565656", width: "2.7%", maxWidth: "24px", minHeight: "24px", flexDirection: "row", display: "flex", alignItems: "center", justifyContent: "center" };
const sharedSxStyle18 = { height: "16px", color: "#565656", width: "1.7%", maxWidth: "16px", minHeight: "16px", flexDirection: "row", display: "flex", alignItems: "center", justifyContent: "center" };
const sharedSxStyle19 = { p: 0 };
const sharedSxStyle20 = { position: "relative", width: "100%", maxWidth: "960px", minHeight: "60px", display: "flex", flexDirection: "row", gap: 1.2, py: 1.6, px: 2 };

export default function BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen(props: Readonly<BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1ScreenProps>) {
  const resolvedVariantId = resolveInitialVariantId(props);
  const resolvedScenario = variantScenarioConfig[resolvedVariantId];
  const screenContent = renderVariantContent(resolvedVariantId, resolvedScenario);
  return (
    <AppShell1>
      {screenContent}
    </AppShell1>
  );
}
