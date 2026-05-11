import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Alert, Avatar, Button, Card, CardContent, Chip, Container, Divider, FormControl, FormHelperText, IconButton, InputLabel, MenuItem, Radio, Select, Stack, SvgIcon, TextField } from "@mui/material";
import { SeitenContentPatternContextProvider, type SeitenContentPatternContextState } from "../context/SeitenContentPatternContext";
import { SeitenContentFormContextProvider, useSeitenContentFormContext } from "../context/SeitenContentFormContext";

const patternContextInitialState: SeitenContentPatternContextState = {
  "SeitenContentPattern1": {
    "I1:65827;26925:38672": {
      "requierdLabelText": "Konkrete Bezeichnung des Investitionsobjekts"
    },
    "I1:65828;27001:82707": {
      "requierdLabelText": "Art des Investitionsobjekts"
    },
    "I1:65897;26925:38672": {
      "requierdLabelText": "Höhe des Kaufpreises (Netto)"
    }
  }
};

function SeitenContentScreenContent() {
  const { selectOptions, control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitting, isSubmitted } = useSeitenContentFormContext();
  return (
    <Container id="main-content" maxWidth="lg" role="main" component="form" onSubmit={((event) => { void handleSubmit(onSubmit)(event); })} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 1528px)", bgcolor: "background.default", px: 2, py: 2 }}>
      {/* @ir:start 2:1042 <Stack> stack */}
      <Stack data-ir-id="2:1042" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "100%", maxWidth: "960px", minHeight: "1460px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 4 }}>
        {/* @ir:start 1:65764 <Stack> stack */}
        <Stack data-ir-id="1:65764" data-ir-name="<Stack>" direction="column" spacing={0} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "86px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {/* @ir:start I1:65764;4919:305782 <Divider> divider */}
          <Divider data-ir-id="I1:65764;4919:305782" data-ir-name="<Divider>" aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "1px", display: "flex", flexDirection: "column" }} />
          {/* @ir:end I1:65764;4919:305782 */}
          {/* @ir:start I1:65764;4919:306280 <Stack2>(Nested) stack */}
          <Stack data-ir-id="I1:65764;4919:306280" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1.5} aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "84px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2, px: 2.5 }}>
            {/* @ir:start I1:65764;4919:306280;9445:27854 <Avatar> avatar */}
            <Avatar data-ir-id="I1:65764;4919:306280;9445:27854" data-ir-name="<Avatar>" sx={{ width: "5%", maxWidth: "48px", minHeight: "48px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", bgcolor: "grey.100", borderRadius: 8 }}></Avatar>
            {/* @ir:end I1:65764;4919:306280;9445:27854 */}
            {/* @ir:start I1:65764;4919:306280;9445:27870 <Stack3>(Nested) stack */}
            <Stack data-ir-id="I1:65764;4919:306280;9445:27870" data-ir-name="<Stack3>(Nested)" direction="column" spacing={0.5} aria-hidden="true" sx={{ width: "89.6%", maxWidth: "860px", minHeight: "48px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              {/* @ir:start I1:65764;4919:306280;9445:27870;9445:28813 <Stack4>(Nested) stack */}
              <Stack data-ir-id="I1:65764;4919:306280;9445:27870;9445:28813" data-ir-name="<Stack4>(Nested)" direction="row" spacing={0.5} aria-hidden="true" sx={{ width: "100%", maxWidth: "860px", minHeight: "20px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                {/* @ir:start I1:65764;4919:306280;9445:27870;9445:28813;9445:29980 <Icon> container */}
                <SvgIcon data-ir-id="I1:65764;4919:306280;9445:27870;9445:28813;9445:29980" data-ir-name="<Icon>" aria-hidden="true" sx={{ height: "16px", color: "text.secondary", width: "1.9%", maxWidth: "16px", minHeight: "16px", flexDirection: "row", display: "flex", alignItems: "center", justifyContent: "center" }} viewBox={"0 0 16 16"}><path d={"M13.138 6.862L9.138 2.862C9.0765 2.79833 9.00294 2.74754 8.9216 2.7126C8.84027 2.67766 8.75279 2.65927 8.66427 2.6585C8.57575 2.65773 8.48796 2.6746 8.40603 2.70812C8.3241 2.74164 8.24967 2.79114 8.18707 2.85374C8.12447 2.91633 8.07497 2.99077 8.04145 3.0727C8.00793 3.15463 7.99106 3.24241 7.99183 3.33093C7.9926 3.41945 8.01099 3.50693 8.04593 3.58827C8.08087 3.66961 8.13166 3.74317 8.19533 3.80467L11.0573 6.66667L1.33333 6.66667L1.33333 0.666667C1.33333 0.489856 1.2631 0.320286 1.13807 0.195262C1.01305 0.0702379 0.843478 5.92119e-16 0.666667 0C0.489856 5.92119e-16 0.320286 0.0702379 0.195262 0.195262C0.0702379 0.320286 5.92119e-16 0.489856 0 0.666667L0 7.33333C2.96059e-16 7.51014 0.0702379 7.67971 0.195262 7.80474C0.320286 7.92976 0.489856 8 0.666667 8L11.0573 8L8.19533 10.862C8.13166 10.9235 8.08087 10.9971 8.04593 11.0784C8.01099 11.1597 7.9926 11.2472 7.99183 11.3357C7.99106 11.4243 8.00793 11.512 8.04145 11.594C8.07497 11.6759 8.12447 11.7503 8.18707 11.8129C8.24967 11.8755 8.3241 11.925 8.40603 11.9585C8.48796 11.9921 8.57575 12.0089 8.66427 12.0082C8.75279 12.0074 8.84027 11.989 8.9216 11.9541C9.00294 11.9191 9.0765 11.8683 9.138 11.8047L13.138 7.80467C13.1999 7.74279 13.2491 7.66931 13.2826 7.58844C13.3161 7.50757 13.3334 7.42088 13.3334 7.33333C13.3334 7.24579 13.3161 7.1591 13.2826 7.07823C13.2491 6.99735 13.1999 6.92388 13.138 6.862L13.138 6.862Z"} /></SvgIcon>
                {/* @ir:end I1:65764;4919:306280;9445:27870;9445:28813;9445:29980 */}
              </Stack>
              {/* @ir:end I1:65764;4919:306280;9445:27870;9445:28813 */}
            </Stack>
            {/* @ir:end I1:65764;4919:306280;9445:27870 */}
          </Stack>
          {/* @ir:end I1:65764;4919:306280 */}
          {/* @ir:start I1:65764;4919:306286 <Divider> divider */}
          <Divider data-ir-id="I1:65764;4919:306286" data-ir-name="<Divider>" aria-hidden="true" sx={{ width: "100%", maxWidth: "960px", minHeight: "1px", display: "flex", flexDirection: "column" }} />
          {/* @ir:end I1:65764;4919:306286 */}
        </Stack>
        {/* @ir:end 1:65764 */}
        {/* @ir:start 1:65766 <Stack> stack */}
        <Stack data-ir-id="1:65766" data-ir-name="<Stack>" direction="column" spacing={1.5} sx={{ width: "100%", maxWidth: "960px", minHeight: "214px", display: "flex", flexDirection: "column", justifyContent: "center", py: 4 }}>
          {/* @ir:start 1:65798 <Stack> stack */}
          <Stack data-ir-id="1:65798" data-ir-name="<Stack>" direction="row" spacing={1.5} aria-hidden="true" sx={sharedSxStyle1}>
            {/* @ir:start I1:65798;5213:6541 <Icon> container */}
            <SvgIcon data-ir-id="I1:65798;5213:6541" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle2} viewBox={"0 0 24 24"}><path d={"M13.3846 12.0002C13.8455 12.0105 14.2871 12.1875 14.6277 12.4982C14.9684 12.8091 15.1848 13.2334 15.2371 13.6916L15.99 18.8557C16.0108 18.9976 16.0009 19.1427 15.9607 19.2805C15.9205 19.4182 15.8515 19.5459 15.7576 19.6545C15.6638 19.763 15.5473 19.8497 15.4168 19.9094C15.2863 19.969 15.1443 20.0002 15.0008 20.0002L1.00079 20.0002C0.857161 20.0003 0.714424 19.9691 0.583793 19.9094C0.453341 19.8497 0.336806 19.763 0.242973 19.6545C0.149135 19.5459 0.08006 19.4182 0.039848 19.2805C-0.000313846 19.1427 -0.0101904 18.9976 0.0105511 18.8557L0.763481 13.6916C0.815817 13.2334 1.03219 12.8091 1.37286 12.4982C1.71343 12.1875 2.15509 12.0106 2.61602 12.0002L13.3846 12.0002ZM2.15704 18.0002L13.8445 18.0002L13.2606 14.0002L2.74395 14.0002L2.15704 18.0002ZM7.0252 0.095893C7.99504 -0.0970194 9.00029 0.00267759 9.91387 0.381049C10.8274 0.759429 11.6086 1.39981 12.158 2.22187C12.7074 3.04411 13.0008 4.01128 13.0008 5.00019C12.9992 6.32578 12.4723 7.59703 11.535 8.53437C10.5976 9.47171 9.32638 9.9986 8.00079 10.0002C7.01188 10.0002 6.04471 9.70682 5.22247 9.15742C4.4004 8.60802 3.76002 7.82676 3.38164 6.91328C3.00327 5.9997 2.90358 4.99444 3.09649 4.0246C3.28942 3.05472 3.76638 2.16428 4.46563 1.46503C5.16488 0.765786 6.05532 0.288827 7.0252 0.095893ZM8.00079 2.00019C7.40744 2.00019 6.82714 2.17641 6.33379 2.50605C5.84071 2.8356 5.45634 3.30386 5.2293 3.85175C5.00228 4.39983 4.94273 5.0033 5.0584 5.58515C5.17416 6.16709 5.46014 6.70173 5.87969 7.12128C6.29925 7.54084 6.83388 7.82682 7.41582 7.94257C7.99767 8.05825 8.60114 7.9987 9.14922 7.77167C9.69712 7.54464 10.1654 7.16026 10.4949 6.66718C10.8246 6.17383 11.0008 5.59353 11.0008 5.00019C11.0008 4.20454 10.6845 3.4417 10.1219 2.8791C9.55927 2.31649 8.79643 2.00019 8.00079 2.00019Z"} /><path d={"M5 10C4.0111 10 3.0444 9.70676 2.22215 9.15735C1.39991 8.60794 0.759043 7.82705 0.380605 6.91342C0.00216642 5.99979 -0.0968503 4.99446 0.0960759 4.02455C0.289002 3.05465 0.765206 2.16373 1.46447 1.46447C2.16373 0.765206 3.05465 0.289002 4.02455 0.0960759C4.99446 -0.0968503 5.99979 0.00216642 6.91342 0.380605C7.82705 0.759043 8.60794 1.39991 9.15735 2.22215C9.70676 3.0444 10 4.0111 10 5C9.99841 6.3256 9.47112 7.59644 8.53378 8.53378C7.59644 9.47112 6.3256 9.99841 5 10L5 10ZM5 2C4.40666 2 3.82664 2.17595 3.33329 2.50559C2.83994 2.83524 2.45543 3.30377 2.22836 3.85195C2.0013 4.40013 1.94189 5.00333 2.05765 5.58527C2.1734 6.16722 2.45912 6.70177 2.87868 7.12132C3.29824 7.54088 3.83279 7.8266 4.41473 7.94236C4.99667 8.05811 5.59987 7.9987 6.14805 7.77164C6.69623 7.54458 7.16477 7.16006 7.49441 6.66671C7.82406 6.17337 8 5.59335 8 5C8 4.20435 7.68393 3.44129 7.12132 2.87868C6.55871 2.31607 5.79565 2 5 2L5 2Z"} /><path d={"M15.0006 8L1.00057 8C0.856943 8.00008 0.714986 7.96922 0.584356 7.90953C0.453725 7.84983 0.337486 7.7627 0.243548 7.65405C0.14961 7.54541 0.0801783 7.4178 0.0399755 7.27992C-0.000227381 7.14203 -0.0102572 6.99711 0.0105684 6.855L0.763568 1.691C0.815905 1.23279 1.03244 0.809042 1.3731 0.498163C1.71376 0.187284 2.15549 0.010315 2.61657 0L13.3846 0C13.8456 0.010315 14.2874 0.187284 14.628 0.498163C14.9687 0.809042 15.1852 1.23279 15.2376 1.691L15.9906 6.855C16.0114 6.99711 16.0014 7.14203 15.9612 7.27992C15.921 7.4178 15.8515 7.54541 15.7576 7.65405C15.6636 7.7627 15.5474 7.84983 15.4168 7.90953C15.2861 7.96922 15.1442 8.00008 15.0006 8ZM2.15757 6L13.8446 6L13.2606 2L2.74457 2L2.15757 6Z"} /></SvgIcon>
            {/* @ir:end I1:65798;5213:6541 */}
          </Stack>
          {/* @ir:end 1:65798 */}
          {/* @ir:start 1:65799 <Card> card */}
          <Card data-ir-id="1:65799" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "112px", display: "flex", flexDirection: "column", bgcolor: "background.default", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <CardContent>
              {/* @ir:start 1:65807 <Select> select */}
              <Controller data-ir-id="1:65807" data-ir-name="<Select>"
                name={"_select__1_65807"}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  const helperText = resolveFieldErrorMessage({
                    fieldKey: "_select__1_65807",
                    isTouched: fieldState.isTouched,
                    isSubmitted,
                    fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                  });
                  return (
                    <FormControl
                      error={Boolean(helperText)}
                      sx={sharedSxStyle3}
                    >
                      <InputLabel id={"_select__1_65807-label"}>{"Person"}</InputLabel>
                      <Select
                        labelId={"_select__1_65807-label"}
                        label={"Person"}
                        value={controllerField.value}
                        onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
                        onBlur={controllerField.onBlur}
                        aria-invalid={Boolean(helperText)}
                        aria-describedby={"_select__1_65807-helper-text"}
                        aria-label={"Person"}
                      >
                        {(selectOptions["_select__1_65807"] ?? []).map((option) => (
                          <MenuItem key={option} value={option}>{option}</MenuItem>
                        ))}
                      </Select>
                      <FormHelperText id={"_select__1_65807-helper-text"}>{helperText}</FormHelperText>
                    </FormControl>
                  );
                }}
              />
              {/* @ir:end 1:65807 */}
            </CardContent>
          </Card>
          {/* @ir:end 1:65799 */}
        </Stack>
        {/* @ir:end 1:65766 */}
        {/* @ir:start 1:65817 <Stack> stack */}
        <Stack data-ir-id="1:65817" data-ir-name="<Stack>" direction="column" spacing={1.5} sx={{ width: "100%", maxWidth: "960px", minHeight: "335px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 4 }}>
          {/* @ir:start 1:65819 <Stack4>(Nested) stack */}
          <Stack data-ir-id="1:65819" data-ir-name="<Stack4>(Nested)" direction="row" spacing={1} aria-hidden="true" sx={sharedSxStyle1}>
            {/* @ir:start I1:65819;9445:29980 <Icon> container */}
            <SvgIcon data-ir-id="I1:65819;9445:29980" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle2} viewBox={"0 0 24 24"}><path d={"M7.5625 15.1338C7.86934 15.1333 8.17338 15.1926 8.45703 15.3096C8.74072 15.4266 8.99859 15.5987 9.21582 15.8154C9.43303 16.0322 9.605 16.2898 9.72266 16.5732C9.84031 16.8567 9.90124 17.1609 9.90137 17.4678C9.90148 17.9293 9.76499 18.3807 9.50879 18.7646C9.25256 19.1486 8.8882 19.448 8.46191 19.625C8.03558 19.802 7.5661 19.8484 7.11328 19.7588C6.66038 19.6691 6.24381 19.4472 5.91699 19.1211C5.59028 18.795 5.36798 18.3794 5.27734 17.9268C5.18673 17.4741 5.23218 17.0049 5.4082 16.5781C5.58429 16.1513 5.88312 15.7864 6.2666 15.5293C6.65006 15.2722 7.10085 15.1346 7.5625 15.1338ZM14.5303 15.1338C15.1492 15.1343 15.7429 15.3798 16.1807 15.8174C16.6184 16.2552 16.8647 16.8496 16.8652 17.4688C16.8652 17.9304 16.7282 18.3817 16.4717 18.7656C16.2151 19.1496 15.8505 19.4493 15.4238 19.626C14.9974 19.8026 14.5279 19.8488 14.0752 19.7588C13.6222 19.6687 13.2055 19.4457 12.8789 19.1191C12.5525 18.7926 12.3303 18.3766 12.2402 17.9238C12.1502 17.471 12.1964 17.0018 12.373 16.5752C12.5498 16.1485 12.8494 15.7839 13.2334 15.5273C13.6174 15.2708 14.0685 15.1338 14.5303 15.1338ZM7.47363 17.0234C7.38595 17.041 7.30542 17.0842 7.24219 17.1475C7.17895 17.2108 7.13564 17.2911 7.11816 17.3789C7.1007 17.4667 7.10934 17.5579 7.14355 17.6406C7.1778 17.7233 7.23619 17.794 7.31055 17.8438C7.38504 17.8935 7.47291 17.9199 7.5625 17.9199C7.68254 17.9196 7.79793 17.872 7.88281 17.7871C7.96742 17.7023 8.01525 17.5875 8.01562 17.4678C8.01562 17.3783 7.98912 17.2903 7.93945 17.2158C7.88968 17.1413 7.81813 17.0831 7.73535 17.0488C7.65268 17.0147 7.56137 17.006 7.47363 17.0234ZM14.4424 17.0234C14.3545 17.0409 14.2733 17.0841 14.21 17.1475C14.1467 17.2108 14.1034 17.2912 14.0859 17.3789C14.0685 17.4667 14.0771 17.5579 14.1113 17.6406C14.1456 17.7233 14.204 17.794 14.2783 17.8438C14.3528 17.8935 14.4407 17.9199 14.5303 17.9199C14.6503 17.9197 14.7657 17.872 14.8506 17.7871C14.9352 17.7023 14.983 17.5876 14.9834 17.4678C14.9834 17.3783 14.9569 17.2903 14.9072 17.2158C14.8575 17.1414 14.7867 17.0831 14.7041 17.0488C14.6214 17.0146 14.5301 17.0061 14.4424 17.0234ZM3.54004 0C3.75554 0.000738312 3.96421 0.0754943 4.13184 0.210938C4.2994 0.346336 4.41591 0.53466 4.46191 0.745117L5.13379 4.11035L19.0596 4.11035C19.1978 4.1107 19.3349 4.14146 19.46 4.2002C19.5849 4.25893 19.6957 4.34416 19.7842 4.4502C19.8734 4.55734 19.9371 4.68329 19.9717 4.81836C20.0063 4.95345 20.0111 5.09458 19.9844 5.23145L18.667 12.1406C18.5494 12.7281 18.2321 13.2569 17.7695 13.6377C17.3069 14.0184 16.7271 14.2281 16.1279 14.2305L7.34863 14.2305C6.75245 14.2274 6.17581 14.018 5.71582 13.6387C5.25583 13.2593 4.94081 12.7332 4.82422 12.1484L3.44727 5.27539C3.43619 5.23803 3.42958 5.19912 3.42871 5.16016L2.76758 1.88281L0.941406 1.88281C0.691838 1.88281 0.451862 1.78292 0.275391 1.60645C0.0990942 1.43001 1.06018e-05 1.19084 0 0.941406C0 0.691981 0.0991097 0.45281 0.275391 0.276367C0.451862 0.0998955 0.691838 -4.44089e-16 0.941406 0L3.54004 0ZM5.51074 5.99121L6.67188 11.7754C6.69921 11.9394 6.78528 12.0881 6.91406 12.1934C7.04287 12.2986 7.20583 12.3536 7.37207 12.3477L16.0967 12.3477C16.2643 12.3481 16.4275 12.2911 16.5586 12.1865C16.6896 12.082 16.7815 11.936 16.8184 11.7725L17.9219 5.99121L5.51074 5.99121Z"} /><path d={"M2.331 3.4268e-06C1.86931 0.000794375 1.41822 0.138436 1.03473 0.395534C0.651249 0.652632 0.352589 1.01764 0.176501 1.44444C0.000413328 1.87123 -0.0451991 2.34064 0.0454297 2.79335C0.136058 3.24606 0.35886 3.66174 0.685674 3.98786C1.01249 4.31397 1.42865 4.53589 1.88155 4.62555C2.33445 4.71521 2.80377 4.66859 3.23018 4.49159C3.6566 4.31459 4.02097 4.01515 4.27725 3.63112C4.53352 3.24708 4.6702 2.79569 4.67 2.334C4.66987 2.02711 4.60924 1.72326 4.49159 1.43982C4.37394 1.15638 4.20156 0.898911 3.98433 0.68214C3.76709 0.465369 3.50926 0.293547 3.22556 0.1765C2.94187 0.0594531 2.63789 -0.000522322 2.331 3.4268e-06L2.331 3.4268e-06ZM2.331 2.787C2.24141 2.787 2.15382 2.76043 2.07933 2.71066C2.00483 2.66088 1.94677 2.59013 1.91248 2.50736C1.8782 2.42459 1.86923 2.3335 1.8867 2.24563C1.90418 2.15775 1.94733 2.07704 2.01068 2.01368C2.07403 1.95033 2.15475 1.90719 2.24262 1.88971C2.3305 1.87223 2.42158 1.8812 2.50436 1.91549C2.58713 1.94977 2.65788 2.00783 2.70766 2.08233C2.75743 2.15683 2.784 2.24441 2.784 2.334C2.78374 2.45406 2.73592 2.56913 2.65103 2.65403C2.56613 2.73893 2.45106 2.78674 2.331 2.787Z"} /><path d={"M2.335 0C1.87318 3.55271e-15 1.42173 0.136945 1.03774 0.393518C0.653756 0.650092 0.354473 1.01477 0.177742 1.44143C0.0010114 1.8681 -0.045229 2.33759 0.0448675 2.79054C0.134964 3.24348 0.357351 3.65954 0.683907 3.9861C1.01046 4.31265 1.42652 4.53504 1.87946 4.62513C2.33241 4.71523 2.8019 4.66899 3.22857 4.49226C3.65523 4.31553 4.01991 4.01625 4.27648 3.63226C4.53306 3.24827 4.67 2.79682 4.67 2.335L4.67 2.335C4.66947 1.71588 4.42329 1.12227 3.98551 0.68449C3.54773 0.246707 2.95412 0.000529614 2.335 0L2.335 0ZM2.335 2.787C2.24541 2.787 2.15782 2.76043 2.08333 2.71066C2.00883 2.66088 1.95077 2.59013 1.91648 2.50736C1.8822 2.42458 1.87323 2.3335 1.8907 2.24562C1.90818 2.15775 1.95133 2.07703 2.01468 2.01368C2.07804 1.95033 2.15875 1.90718 2.24662 1.8897C2.3345 1.87222 2.42558 1.8812 2.50836 1.91548C2.59113 1.94977 2.66188 2.00783 2.71166 2.08233C2.76143 2.15682 2.788 2.2444 2.788 2.334L2.788 2.334C2.78774 2.45406 2.73993 2.56913 2.65503 2.65403C2.57013 2.73892 2.45506 2.78674 2.335 2.787Z"} /><path d={"M19.784 4.45C19.6955 4.34389 19.5848 4.25846 19.4597 4.19972C19.3346 4.14098 19.1982 4.11035 19.06 4.11L5.134 4.11L4.462 0.745C4.41603 0.53444 4.29961 0.345858 4.13198 0.210405C3.96434 0.0749514 3.75552 0.000729758 3.54 0L0.941 0C0.691431 -4.44089e-16 0.452084 0.0991409 0.275612 0.275613C0.0991407 0.452084 0 0.691431 0 0.941C0 1.19057 0.0991407 1.42992 0.275612 1.60639C0.452084 1.78286 0.691431 1.882 0.941 1.882L2.768 1.882L3.429 5.16C3.42987 5.19896 3.43592 5.23764 3.447 5.275L4.824 12.148C4.94058 12.7328 5.25554 13.2594 5.71563 13.6388C6.17571 14.0181 6.75269 14.227 7.349 14.23L16.128 14.23C16.7272 14.2276 17.3072 14.0182 17.7699 13.6374C18.2326 13.2566 18.5495 12.7276 18.667 12.14L19.984 5.231C20.0107 5.09414 20.0067 4.95304 19.9721 4.81794C19.9375 4.68285 19.8732 4.55716 19.784 4.45L19.784 4.45ZM16.818 11.772C16.7811 11.9356 16.6896 12.0817 16.5585 12.1862C16.4275 12.2907 16.2647 12.3475 16.097 12.347L7.372 12.347C7.20576 12.3529 7.04306 12.2981 6.91425 12.1929C6.78544 12.0876 6.69934 11.9391 6.672 11.775L5.511 5.991L17.922 5.991L16.818 11.772Z"} /></SvgIcon>
            {/* @ir:end I1:65819;9445:29980 */}
          </Stack>
          {/* @ir:end 1:65819 */}
          {/* @ir:start 1:65820 <Card> card */}
          <Card data-ir-id="1:65820" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "265px", display: "flex", flexDirection: "column", bgcolor: "background.default", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <CardContent>
              {/* @ir:start 1:65827 <TextField> input */}
              <Controller data-ir-id="1:65827" data-ir-name="<TextField>"
                name={"_textfield__1_65827"}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  const helperText = resolveFieldErrorMessage({
                    fieldKey: "_textfield__1_65827",
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
                      aria-invalid={Boolean(helperText)}
                      aria-describedby={"_textfield__1_65827-helper-text"}
                sx={{
                  width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column", gap: 1,
                  "& .MuiInputLabel-root": { color: "text.secondary" }
                }}

                      slotProps={{
                        htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "_textfield__1_65827-helper-text" },
                  formHelperText: { id: "_textfield__1_65827-helper-text" }
                      }}
                    />
                  );
                }}
              />
              {/* @ir:end 1:65827 */}
              {/* @ir:start 1:65828 <Select> select */}
              <Controller data-ir-id="1:65828" data-ir-name="<Select>"
                name={"_select__1_65828"}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  const helperText = resolveFieldErrorMessage({
                    fieldKey: "_select__1_65828",
                    isTouched: fieldState.isTouched,
                    isSubmitted,
                    fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                  });
                  return (
                    <FormControl
                      error={Boolean(helperText)}
                      sx={sharedSxStyle3}
                    >
                      <InputLabel id={"_select__1_65828-label"}>{"Art des Investitionsobjekts"}</InputLabel>
                      <Select
                        labelId={"_select__1_65828-label"}
                        label={"Art des Investitionsobjekts"}
                        value={controllerField.value}
                        onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
                        onBlur={controllerField.onBlur}
                        aria-invalid={Boolean(helperText)}
                        aria-describedby={"_select__1_65828-helper-text"}
                        aria-label={"Art des Investitionsobjekts"}
                      >
                        {(selectOptions["_select__1_65828"] ?? []).map((option) => (
                          <MenuItem key={option} value={option}>{option}</MenuItem>
                        ))}
                      </Select>
                      <FormHelperText id={"_select__1_65828-helper-text"}>{helperText}</FormHelperText>
                    </FormControl>
                  );
                }}
              />
              {/* @ir:end 1:65828 */}
              {/* @ir:start 1:65829 <Stack> stack */}
              <Stack data-ir-id="1:65829" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "73px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {/* @ir:start 1:65835 <Divider> divider */}
                <Divider data-ir-id="1:65835" data-ir-name="<Divider>" aria-hidden="true" sx={{ width: "100%", maxWidth: "918px", minHeight: "1px", display: "flex", flexDirection: "column" }} />
                {/* @ir:end 1:65835 */}
                {/* @ir:start 1:65838 <Stack2>(Nested) stack */}
                <Stack data-ir-id="1:65838" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1} sx={{ width: "100%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", px: 2.5 }}>
                  {/* @ir:start I1:65838;9445:27870 <Stack6>(Nested) stack */}
                  <Stack data-ir-id="I1:65838;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2.5} sx={{ width: "27.7%", maxWidth: "254px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end" }}>
                    {/* @ir:start I1:65838;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                    <Stack data-ir-id="I1:65838;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={1} sx={{ width: "28.7%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      {/* @ir:start I1:65838;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                      <Stack data-ir-id="I1:65838;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                        {/* @ir:start I1:65838;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                        <Stack data-ir-id="I1:65838;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2 }}>
                          {/* @ir:start I1:65838;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                          <Radio data-ir-id="I1:65838;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={{ width: "54.8%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                          {/* @ir:end I1:65838;9445:27870;9445:32106;5646:54691 */}
                        </Stack>
                        {/* @ir:end I1:65838;9445:27870;9445:32106;5646:54690 */}
                      </Stack>
                      {/* @ir:end I1:65838;9445:27870;9445:32106;5646:54689 */}
                    </Stack>
                    {/* @ir:end I1:65838;9445:27870;9445:32106 */}
                    {/* @ir:start I1:65838;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                    <Stack data-ir-id="I1:65838;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={1} sx={{ width: "35.4%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      {/* @ir:start I1:65838;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                      <Stack data-ir-id="I1:65838;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                        {/* @ir:start I1:65838;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                        <Stack data-ir-id="I1:65838;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2 }}>
                          {/* @ir:start I1:65838;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                          <Radio data-ir-id="I1:65838;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={{ width: "44.4%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                          {/* @ir:end I1:65838;9445:27870;9445:32122;5646:54691 */}
                        </Stack>
                        {/* @ir:end I1:65838;9445:27870;9445:32122;5646:54690 */}
                      </Stack>
                      {/* @ir:end I1:65838;9445:27870;9445:32122;5646:54689 */}
                    </Stack>
                    {/* @ir:end I1:65838;9445:27870;9445:32122 */}
                  </Stack>
                  {/* @ir:end I1:65838;9445:27870 */}
                </Stack>
                {/* @ir:end 1:65838 */}
              </Stack>
              {/* @ir:end 1:65829 */}
            </CardContent>
          </Card>
          {/* @ir:end 1:65820 */}
        </Stack>
        {/* @ir:end 1:65817 */}
        {/* @ir:start 1:65866 <Stack> stack */}
        <Stack data-ir-id="1:65866" data-ir-name="<Stack>" direction="column" spacing={1.5} sx={{ width: "100%", maxWidth: "960px", minHeight: "531px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pb: 1.5 }}>
          {/* @ir:start 1:65868 <Stack3>(Nested) stack */}
          <Stack data-ir-id="1:65868" data-ir-name="<Stack3>(Nested)" direction="row" spacing={1} aria-hidden="true" sx={sharedSxStyle1}>
            {/* @ir:start I1:65868;9445:28917 <Icon> container */}
            <SvgIcon data-ir-id="I1:65868;9445:28917" data-ir-name="<Icon>" aria-hidden="true" sx={sharedSxStyle2} viewBox={"0 0 24 24"}><path d={"M5.6344 6.13477C6.99227 5.86467 8.40024 6.00339 9.67932 6.5332C10.9582 7.06304 12.0518 7.96031 12.8209 9.11133C13.5899 10.2624 14.0006 11.6157 14.0006 13C13.9985 14.8558 13.26 16.635 11.9479 17.9473C10.6357 19.2595 8.85633 19.9978 7.00061 20C5.61614 20 4.26211 19.5895 3.11096 18.8203C1.9599 18.0511 1.06263 16.9577 0.532839 15.6787C0.00313067 14.3998 -0.135568 12.9924 0.134401 11.6348C0.404498 10.2769 1.07145 9.02877 2.05042 8.0498C3.0293 7.071 4.27671 6.40487 5.6344 6.13477ZM17.0006 0C17.2657 0.000105389 17.5202 0.105526 17.7076 0.292969C17.8951 0.480486 18.0006 0.734877 18.0006 1L18.0006 3C18.2657 3.00011 18.5202 3.10553 18.7076 3.29297C18.8951 3.48049 19.0006 3.73488 19.0006 4L19.0006 7C19.0006 7.26512 18.8951 7.51951 18.7076 7.70703C18.5202 7.89447 18.2657 7.99989 18.0006 8L17.0006 8L17.0006 9L19.0006 9C19.2657 9.00011 19.5202 9.10553 19.7076 9.29297C19.8951 9.48049 20.0006 9.73488 20.0006 10L20.0006 13C20.0006 13.2651 19.8951 13.5195 19.7076 13.707C19.5202 13.8945 19.2657 13.9999 19.0006 14L18.0006 14L18.0006 15C18.2657 15.0001 18.5202 15.1055 18.7076 15.293C18.8951 15.4805 19.0006 15.7349 19.0006 16L19.0006 19C19.0006 19.2651 18.8951 19.5195 18.7076 19.707C18.5202 19.8945 18.2657 19.9999 18.0006 20L10.8639 20C11.7767 19.4938 12.5822 18.8144 13.235 18L17.0006 18L17.0006 17L13.9186 17C14.2811 16.3737 14.5561 15.7007 14.7369 15L16.0006 15L16.0006 14L14.9313 14C15.0233 13.3365 15.0233 12.6635 14.9313 12L18.0006 12L18.0006 11L14.7369 11C14.5561 10.2993 14.2811 9.62629 13.9186 9L15.0006 9L15.0006 8L13.235 8C12.5822 7.1856 11.7767 6.50619 10.8639 6L17.0006 6L17.0006 5L8.00061 5L8.00061 5.06934C7.66917 5.02559 7.33492 5.00221 7.00061 5C6.66629 5.0022 6.33207 5.02561 6.00061 5.06934L6.00061 5C5.73549 5 5.4811 4.89444 5.29358 4.70703C5.10604 4.5195 5.00061 4.26522 5.00061 4L5.00061 1C5.00061 0.734784 5.10604 0.480505 5.29358 0.292969C5.4811 0.105557 5.73549 4.43932e-16 6.00061 0L17.0006 0ZM7.00061 8C6.01171 8 5.04454 8.29337 4.22229 8.84277C3.4001 9.39218 2.75892 10.1733 2.38049 11.0869C2.00219 12.0004 1.90342 13.0058 2.09632 13.9756C2.28923 14.9453 2.76541 15.836 3.46448 16.5352C4.16374 17.2344 5.05512 17.7114 6.02503 17.9043C6.99483 18.0971 8.00017 17.9975 8.9137 17.6191C9.82719 17.2407 10.6085 16.6004 11.1578 15.7783C11.7072 14.9561 12.0006 13.9889 12.0006 13C11.999 11.6744 11.4712 10.4032 10.5338 9.46582C9.5966 8.52876 8.32593 8.00169 7.00061 8ZM10.5006 12.5C10.6331 12.5001 10.7605 12.5528 10.8541 12.6465C10.9478 12.7402 11.0006 12.8675 11.0006 13C11.0006 14.0608 10.5788 15.078 9.82874 15.8281C9.07869 16.5782 8.06133 16.9999 7.00061 17C6.8681 17 6.74085 16.9472 6.6471 16.8535C6.55333 16.7597 6.50061 16.6326 6.50061 16.5C6.50061 16.3674 6.55333 16.2403 6.6471 16.1465C6.74085 16.0528 6.8681 16 7.00061 16C7.79612 15.9999 8.55919 15.6836 9.12171 15.1211C9.68419 14.5585 10.0006 13.7956 10.0006 13C10.0006 12.8674 10.0533 12.7403 10.1471 12.6465C10.2408 12.5528 10.3681 12.5 10.5006 12.5ZM7.00061 9C7.13308 9.0001 7.26045 9.05281 7.35413 9.14648C7.44777 9.24023 7.50061 9.36749 7.50061 9.5C7.50061 9.63251 7.44777 9.75977 7.35413 9.85352C7.26045 9.94719 7.13308 9.9999 7.00061 10C6.20496 10 5.44115 10.3163 4.87854 10.8789C4.31611 11.4415 4.00061 12.2045 4.00061 13C4.00061 13.1325 3.94777 13.2598 3.85413 13.3535C3.76045 13.4472 3.63308 13.4999 3.50061 13.5C3.3681 13.5 3.24085 13.4472 3.1471 13.3535C3.05333 13.2597 3.00061 13.1326 3.00061 13C3.00061 11.9393 3.42155 10.922 4.17151 10.1719C4.92166 9.42173 5.93975 9 7.00061 9ZM7.00061 3L16.0006 3L16.0006 2L7.00061 2L7.00061 3Z"} /><path d={"M14 9L12 9L12 8L13 8C13.2652 8 13.5196 7.89464 13.7071 7.70711C13.8946 7.51957 14 7.26522 14 7L14 4C14 3.73478 13.8946 3.48043 13.7071 3.29289C13.5196 3.10536 13.2652 3 13 3L13 1C13 0.734784 12.8946 0.48043 12.7071 0.292893C12.5196 0.105357 12.2652 6.66134e-16 12 0L1 0C0.734784 4.44089e-16 0.48043 0.105357 0.292893 0.292893C0.105357 0.48043 0 0.734784 0 1L0 4C0 4.26522 0.105357 4.51957 0.292893 4.70711C0.48043 4.89464 0.734784 5 1 5L1 5.069C1.33158 5.02524 1.66556 5.0022 2 5C2.33444 5.0022 2.66842 5.02524 3 5.069L3 5L12 5L12 6L5.864 6C6.77682 6.50621 7.58218 7.18555 8.235 8L10 8L10 9L8.918 9C9.28062 9.62635 9.55616 10.2992 9.737 11L13 11L13 12L9.931 12C10.023 12.6635 10.023 13.3365 9.931 14L11 14L11 15L9.737 15C9.55616 15.7008 9.28062 16.3736 8.918 17L12 17L12 18L8.235 18C7.58218 18.8144 6.77682 19.4938 5.864 20L13 20C13.2652 20 13.5196 19.8946 13.7071 19.7071C13.8946 19.5196 14 19.2652 14 19L14 16C14 15.7348 13.8946 15.4804 13.7071 15.2929C13.5196 15.1054 13.2652 15 13 15L13 14L14 14C14.2652 14 14.5196 13.8946 14.7071 13.7071C14.8946 13.5196 15 13.2652 15 13L15 10C15 9.73478 14.8946 9.48043 14.7071 9.29289C14.5196 9.10536 14.2652 9 14 9ZM11 3L2 3L2 2L11 2L11 3Z"} /><path d={"M7 14C5.61553 14 4.26216 13.5895 3.11101 12.8203C1.95987 12.0511 1.06266 10.9579 0.532846 9.67879C0.00303298 8.3997 -0.13559 6.99224 0.134506 5.63437C0.404603 4.2765 1.07129 3.02922 2.05026 2.05026C3.02922 1.07129 4.2765 0.404603 5.63437 0.134506C6.99224 -0.13559 8.3997 0.00303298 9.67879 0.532846C10.9579 1.06266 12.0511 1.95987 12.8203 3.11101C13.5895 4.26216 14 5.61553 14 7C13.9979 8.85587 13.2597 10.6351 11.9474 11.9474C10.6351 13.2597 8.85587 13.9979 7 14L7 14ZM7 2C6.0111 2 5.0444 2.29325 4.22215 2.84266C3.39991 3.39206 2.75904 4.17296 2.38061 5.08659C2.00217 6.00022 1.90315 7.00555 2.09608 7.97545C2.289 8.94536 2.76521 9.83627 3.46447 10.5355C4.16373 11.2348 5.05465 11.711 6.02455 11.9039C6.99446 12.0969 7.99979 11.9978 8.91342 11.6194C9.82705 11.241 10.6079 10.6001 11.1574 9.77785C11.7068 8.95561 12 7.98891 12 7C11.9984 5.67441 11.4711 4.40356 10.5338 3.46622C9.59645 2.52888 8.3256 2.00159 7 2L7 2Z"} /><path d={"M0.5 4.5C0.367392 4.5 0.240215 4.44732 0.146447 4.35355C0.0526785 4.25979 0 4.13261 0 4C0 2.93913 0.421427 1.92172 1.17157 1.17157C1.92172 0.421427 2.93913 1.77636e-15 4 0C4.13261 0 4.25979 0.052678 4.35355 0.146446C4.44732 0.240214 4.5 0.367392 4.5 0.5C4.5 0.632608 4.44732 0.759786 4.35355 0.853554C4.25979 0.947322 4.13261 1 4 1C3.20435 1 2.44129 1.31607 1.87868 1.87868C1.31607 2.44129 1 3.20435 1 4C1 4.13261 0.947321 4.25979 0.853553 4.35355C0.759785 4.44732 0.632608 4.5 0.5 4.5Z"} /><path d={"M0.5 4.5C0.367392 4.5 0.240214 4.44732 0.146446 4.35355C0.052678 4.25979 0 4.13261 0 4C0 3.86739 0.052678 3.74021 0.146446 3.64645C0.240214 3.55268 0.367392 3.5 0.5 3.5C1.29565 3.5 2.05871 3.18393 2.62132 2.62132C3.18393 2.05871 3.5 1.29565 3.5 0.5C3.5 0.367392 3.55268 0.240214 3.64645 0.146446C3.74021 0.052678 3.86739 0 4 0C4.13261 0 4.25979 0.052678 4.35355 0.146446C4.44732 0.240214 4.5 0.367392 4.5 0.5C4.5 1.56087 4.07857 2.57828 3.32843 3.32843C2.57828 4.07857 1.56087 4.5 0.5 4.5Z"} /></SvgIcon>
            {/* @ir:end I1:65868;9445:28917 */}
          </Stack>
          {/* @ir:end 1:65868 */}
          {/* @ir:start 1:65869 <Card> card */}
          <Card data-ir-id="1:65869" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "481px", display: "flex", flexDirection: "column", bgcolor: "background.default", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <CardContent>
              {/* @ir:start 1:65877 <Stack> stack */}
              <Stack data-ir-id="1:65877" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "128px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 1 }}>
                {/* @ir:start 1:65879 <Stack2>(Nested) stack */}
                <Stack data-ir-id="1:65879" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1} sx={{ width: "100%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", px: 2.5 }}>
                  {/* @ir:start I1:65879;9445:27856 <IconButton> button */}
                  <IconButton data-ir-id="I1:65879;9445:27856" data-ir-name="<IconButton>" aria-label="\u003CIconButton\u003E" sx={{ width: "3.1%", maxWidth: "28px", minHeight: "28px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 0.5, borderRadius: 8, color: "text.secondary" }}><SvgIcon aria-hidden="true" sx={{ width: "20px", height: "20px", color: "text.secondary", fontSize: "inherit" }} viewBox={"0 0 20 20"}><path d={"M6.70715 0.160277C8.32366 -0.161267 9.99986 0.00317946 11.5226 0.63391C13.0451 1.26463 14.3462 2.33301 15.2618 3.70325C16.1775 5.07365 16.6661 6.68495 16.6661 8.33313C16.6637 10.5425 15.7851 12.6605 14.2228 14.2228C12.6605 15.7851 10.5425 16.6637 8.33313 16.6661C6.68495 16.6661 5.07365 16.1775 3.70325 15.2618C2.33301 14.3462 1.26463 13.0451 0.63391 11.5226C0.00317946 9.99986 -0.161267 8.32366 0.160277 6.70715C0.481857 5.09075 1.27518 3.60592 2.44055 2.44055C3.60592 1.27518 5.09075 0.481857 6.70715 0.160277ZM8.33313 1.66614C7.01459 1.66614 5.72535 2.05762 4.62903 2.79016C3.53284 3.52269 2.67849 4.56428 2.17395 5.78235C1.66949 7.00042 1.53783 8.34083 1.79504 9.63391C2.05231 10.927 2.68698 12.1147 3.61926 13.047C4.55155 13.9793 5.73924 14.6139 7.03235 14.8712C8.32542 15.1284 9.66584 14.9968 10.8839 14.4923C12.102 13.9878 13.1436 13.1334 13.8761 12.0372C14.6086 10.9409 15.0001 9.65167 15.0001 8.33313C14.9981 6.56563 14.2949 4.87103 13.045 3.62121C11.7952 2.3714 10.1006 1.66812 8.33313 1.66614ZM8.33313 7.50012C8.55414 7.50012 8.76572 7.58798 8.922 7.74426C9.07828 7.90054 9.16614 8.11211 9.16614 8.33313L9.16614 11.6661C9.16614 11.8872 9.07828 12.0997 8.922 12.256C8.76575 12.4121 8.55399 12.5001 8.33313 12.5001C8.11227 12.5001 7.90051 12.4121 7.74426 12.256C7.58798 12.0997 7.50012 11.8872 7.50012 11.6661L7.50012 8.33313C7.50012 8.11211 7.58798 7.90054 7.74426 7.74426C7.90054 7.58798 8.11211 7.50012 8.33313 7.50012ZM8.33313 4.16614C8.55399 4.16614 8.76575 4.2542 8.922 4.41028C9.07828 4.56656 9.16614 4.77911 9.16614 5.00012C9.16605 5.22102 9.0782 5.43278 8.922 5.58899C8.76573 5.74517 8.55407 5.83313 8.33313 5.83313C8.11219 5.83313 7.90053 5.74517 7.74426 5.58899C7.58806 5.43278 7.50021 5.22102 7.50012 5.00012C7.50012 4.77911 7.58798 4.56656 7.74426 4.41028C7.90051 4.2542 8.11227 4.16614 8.33313 4.16614Z"} /><path d={"M0.833333 1.66667C0.61232 1.66667 0.400358 1.57887 0.244078 1.42259C0.0877975 1.26631 0 1.05435 0 0.833333C0 0.61232 0.0877975 0.400358 0.244078 0.244078C0.400358 0.0877975 0.61232 -7.40149e-16 0.833333 0C1.05435 -7.40149e-16 1.26631 0.0877975 1.42259 0.244078C1.57887 0.400358 1.66667 0.61232 1.66667 0.833333C1.66667 1.05435 1.57887 1.26631 1.42259 1.42259C1.26631 1.57887 1.05435 1.66667 0.833333 1.66667Z"} /><path d={"M0.833333 5C0.61232 5 0.400358 4.9122 0.244078 4.75592C0.0877975 4.59964 0 4.38768 0 4.16667L0 0.833333C0 0.61232 0.0877975 0.400358 0.244078 0.244078C0.400358 0.0877975 0.61232 0 0.833333 0C1.05435 0 1.26631 0.0877975 1.42259 0.244078C1.57887 0.400358 1.66667 0.61232 1.66667 0.833333L1.66667 4.16667C1.66667 4.38768 1.57887 4.59964 1.42259 4.75592C1.26631 4.9122 1.05435 5 0.833333 5Z"} /><path d={"M8.33334 16.6667C6.68516 16.6667 5.07399 16.1779 3.70358 15.2622C2.33318 14.3466 1.26507 13.0451 0.634341 11.5224C0.0036107 9.99965 -0.161417 8.32409 0.160126 6.70758C0.48167 5.09108 1.27534 3.60622 2.44078 2.44078C3.60622 1.27534 5.09108 0.48167 6.70758 0.160126C8.32409 -0.161417 9.99965 0.0036107 11.5224 0.634341C13.0451 1.26507 14.3466 2.33318 15.2622 3.70358C16.1779 5.07399 16.6667 6.68516 16.6667 8.33334C16.6642 10.5427 15.7855 12.6609 14.2232 14.2232C12.6609 15.7855 10.5427 16.6642 8.33334 16.6667L8.33334 16.6667ZM8.33334 1.66667C7.0148 1.66667 5.72586 2.05766 4.62954 2.79021C3.53321 3.52275 2.67872 4.56394 2.17414 5.78211C1.66956 7.00029 1.53753 8.34073 1.79477 9.63394C2.052 10.9271 2.68694 12.115 3.61929 13.0474C4.55164 13.9797 5.73953 14.6147 7.03274 14.8719C8.32594 15.1291 9.66639 14.9971 10.8846 14.4925C12.1027 13.9879 13.1439 13.1335 13.8765 12.0371C14.609 10.9408 15 9.65188 15 8.33334C14.998 6.56584 14.295 4.8713 13.0452 3.62148C11.7954 2.37167 10.1008 1.66866 8.33334 1.66667L8.33334 1.66667Z"} /></SvgIcon></IconButton>
                  {/* @ir:end I1:65879;9445:27856 */}
                  {/* @ir:start I1:65879;9445:27870 <Stack6>(Nested) stack */}
                  <Stack data-ir-id="I1:65879;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2.5} sx={{ width: "61%", maxWidth: "560px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end" }}>
                    {/* @ir:start I1:65879;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                    <Stack data-ir-id="I1:65879;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={1} sx={{ width: "17.3%", maxWidth: "97px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      {/* @ir:start I1:65879;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                      <Stack data-ir-id="I1:65879;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "97px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                        {/* @ir:start I1:65879;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                        <Stack data-ir-id="I1:65879;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "97px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2 }}>
                          {/* @ir:start I1:65879;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                          <Radio data-ir-id="I1:65879;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={{ width: "41.2%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                          {/* @ir:end I1:65879;9445:27870;9445:32106;5646:54691 */}
                        </Stack>
                        {/* @ir:end I1:65879;9445:27870;9445:32106;5646:54690 */}
                      </Stack>
                      {/* @ir:end I1:65879;9445:27870;9445:32106;5646:54689 */}
                    </Stack>
                    {/* @ir:end I1:65879;9445:27870;9445:32106 */}
                    {/* @ir:start I1:65879;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                    <Stack data-ir-id="I1:65879;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={1} sx={{ width: "18.2%", maxWidth: "102px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      {/* @ir:start I1:65879;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                      <Stack data-ir-id="I1:65879;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "102px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                        {/* @ir:start I1:65879;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                        <Stack data-ir-id="I1:65879;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "102px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2 }}>
                          {/* @ir:start I1:65879;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                          <Radio data-ir-id="I1:65879;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={{ width: "39.2%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                          {/* @ir:end I1:65879;9445:27870;9445:32122;5646:54691 */}
                        </Stack>
                        {/* @ir:end I1:65879;9445:27870;9445:32122;5646:54690 */}
                      </Stack>
                      {/* @ir:end I1:65879;9445:27870;9445:32122;5646:54689 */}
                    </Stack>
                    {/* @ir:end I1:65879;9445:27870;9445:32122 */}
                  </Stack>
                  {/* @ir:end I1:65879;9445:27870 */}
                </Stack>
                {/* @ir:end 1:65879 */}
                {/* @ir:start 1:65896 <Alert> alert */}
                <Alert data-ir-id="1:65896" data-ir-name="<Alert>" severity={"info"} sx={{ width: "100%", maxWidth: "918px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", py: 1.5, px: 2.5, borderRadius: 1 }}>{"Die MwSt. ist nicht Teil des Finanzierungsbedarfs."}</Alert>
                {/* @ir:end 1:65896 */}
              </Stack>
              {/* @ir:end 1:65877 */}
              {/* @ir:start 1:65897 <TextField> input */}
              <Controller data-ir-id="1:65897" data-ir-name="<TextField>"
                name={"_textfield__1_65897"}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  const helperText = resolveFieldErrorMessage({
                    fieldKey: "_textfield__1_65897",
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
                      aria-invalid={Boolean(helperText)}
                      aria-describedby={"_textfield__1_65897-helper-text"}
                sx={{
                  width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column", gap: 1,
                  "& .MuiOutlinedInput-root": { color: "primary.main" },
                  "& .MuiInputLabel-root": { color: "text.secondary" }
                }}

                      slotProps={{
                        htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "_textfield__1_65897-helper-text" },
                  formHelperText: { id: "_textfield__1_65897-helper-text" }
                      }}
                    />
                  );
                }}
              />
              {/* @ir:end 1:65897 */}
              {/* @ir:start 1:65898 <Select> select */}
              <Controller data-ir-id="1:65898" data-ir-name="<Select>"
                name={"_select__1_65898"}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  const helperText = resolveFieldErrorMessage({
                    fieldKey: "_select__1_65898",
                    isTouched: fieldState.isTouched,
                    isSubmitted,
                    fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
                  });
                  return (
                    <FormControl
                      error={Boolean(helperText)}
                      sx={sharedSxStyle3}
                    >
                      <InputLabel id={"_select__1_65898-label"}>{"Anfallender MwSt.-Satz bei Kauf"}</InputLabel>
                      <Select
                        labelId={"_select__1_65898-label"}
                        label={"Anfallender MwSt.-Satz bei Kauf"}
                        value={controllerField.value}
                        onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(event.target.value)}
                        onBlur={controllerField.onBlur}
                        aria-invalid={Boolean(helperText)}
                        aria-describedby={"_select__1_65898-helper-text"}
                        aria-label={"Anfallender MwSt.-Satz bei Kauf"}
                      >
                        {(selectOptions["_select__1_65898"] ?? []).map((option) => (
                          <MenuItem key={option} value={option}>{option}</MenuItem>
                        ))}
                      </Select>
                      <FormHelperText id={"_select__1_65898-helper-text"}>{helperText}</FormHelperText>
                    </FormControl>
                  );
                }}
              />
              {/* @ir:end 1:65898 */}
              {/* @ir:start 1:65899 <TextField> input */}
              <Controller data-ir-id="1:65899" data-ir-name="<TextField>"
                name={"_textfield__1_65899"}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  const helperText = resolveFieldErrorMessage({
                    fieldKey: "_textfield__1_65899",
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
                      aria-invalid={Boolean(helperText)}
                      aria-describedby={"_textfield__1_65899-helper-text"}
                sx={{
                  width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column", gap: 1,
                  "& .MuiOutlinedInput-root": { color: "primary.main" },
                  "& .MuiInputLabel-root": { color: "text.secondary" }
                }}

                      slotProps={{
                        htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "_textfield__1_65899-helper-text" },
                  formHelperText: { id: "_textfield__1_65899-helper-text" }
                      }}
                    />
                  );
                }}
              />
              {/* @ir:end 1:65899 */}
              {/* @ir:start 1:65900 <Divider> divider */}
              <Divider data-ir-id="1:65900" data-ir-name="<Divider>" aria-hidden="true" sx={{ width: "95.8%", maxWidth: "918px", minHeight: "13px", display: "flex", flexDirection: "column", pt: 1.5 }} />
              {/* @ir:end 1:65900 */}
              {/* @ir:start 1:65901 <Stack2>(Nested) stack */}
              <Stack data-ir-id="1:65901" data-ir-name="<Stack2>(Nested)" direction="row" spacing={0} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center", pt: 1.5, pr: 2.5, pl: 2.5 }}>
                {/* @ir:start I1:65901;9445:27870 <Chip> chip */}
                <Chip data-ir-id="I1:65901;9445:27870" data-ir-name="<Chip>" label={"0,00 €"} variant="filled" size="medium" sx={{ width: "8.2%", maxWidth: "75px", minHeight: "28px", display: "flex", flexDirection: "row", alignItems: "center", py: 0.5, px: 1, bgcolor: "text.secondary", borderRadius: 8 }} />
                {/* @ir:end I1:65901;9445:27870 */}
              </Stack>
              {/* @ir:end 1:65901 */}
            </CardContent>
          </Card>
          {/* @ir:end 1:65869 */}
        </Stack>
        {/* @ir:end 1:65866 */}
        {/* @ir:start 1:65928 <Stack> stack */}
        <Stack data-ir-id="1:65928" data-ir-name="<Stack>" direction="column" spacing={1.5} sx={{ width: "100%", maxWidth: "960px", minHeight: "114px", display: "flex", flexDirection: "column", justifyContent: "center", pb: 4 }}>
          {/* @ir:start 1:65930 <Card> card */}
          <Card data-ir-id="1:65930" data-ir-name="<Card>" component="article" sx={{ width: "100%", maxWidth: "958px", minHeight: "80px", display: "flex", flexDirection: "column", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <CardContent>
              {/* @ir:start 1:65940 <Stack2>(Nested) stack */}
              <Stack data-ir-id="1:65940" data-ir-name="<Stack2>(Nested)" direction="row" spacing={1} sx={{ width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", px: 2.5 }}>
                {/* @ir:start I1:65940;9445:27870 <Stack6>(Nested) stack */}
                <Stack data-ir-id="I1:65940;9445:27870" data-ir-name="<Stack6>(Nested)" direction="row" spacing={2.5} sx={{ width: "60%", maxWidth: "551px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end" }}>
                  {/* @ir:start I1:65940;9445:27870;9445:32106 <Stack> FormControlLabel | Radio stack */}
                  <Stack data-ir-id="I1:65940;9445:27870;9445:32106" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={1} sx={{ width: "13.2%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    {/* @ir:start I1:65940;9445:27870;9445:32106;5646:54689 <Stack> stack */}
                    <Stack data-ir-id="I1:65940;9445:27870;9445:32106;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                      {/* @ir:start I1:65940;9445:27870;9445:32106;5646:54690 <Stack2>(Nested) stack */}
                      <Stack data-ir-id="I1:65940;9445:27870;9445:32106;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "73px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2 }}>
                        {/* @ir:start I1:65940;9445:27870;9445:32106;5646:54691 <Radio> radio */}
                        <Radio data-ir-id="I1:65940;9445:27870;9445:32106;5646:54691" data-ir-name="<Radio>" sx={{ width: "54.8%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                        {/* @ir:end I1:65940;9445:27870;9445:32106;5646:54691 */}
                      </Stack>
                      {/* @ir:end I1:65940;9445:27870;9445:32106;5646:54690 */}
                    </Stack>
                    {/* @ir:end I1:65940;9445:27870;9445:32106;5646:54689 */}
                  </Stack>
                  {/* @ir:end I1:65940;9445:27870;9445:32106 */}
                  {/* @ir:start I1:65940;9445:27870;9445:32122 <Stack> FormControlLabel | Radio stack */}
                  <Stack data-ir-id="I1:65940;9445:27870;9445:32122" data-ir-name="<Stack> FormControlLabel | Radio" direction="column" spacing={1} sx={{ width: "16.3%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    {/* @ir:start I1:65940;9445:27870;9445:32122;5646:54689 <Stack> stack */}
                    <Stack data-ir-id="I1:65940;9445:27870;9445:32122;5646:54689" data-ir-name="<Stack>" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center" }}>
                      {/* @ir:start I1:65940;9445:27870;9445:32122;5646:54690 <Stack2>(Nested) stack */}
                      <Stack data-ir-id="I1:65940;9445:27870;9445:32122;5646:54690" data-ir-name="<Stack2>(Nested)" direction="row" spacing={2} sx={{ width: "100%", maxWidth: "90px", minHeight: "72px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", py: 2 }}>
                        {/* @ir:start I1:65940;9445:27870;9445:32122;5646:54691 <Radio> radio */}
                        <Radio data-ir-id="I1:65940;9445:27870;9445:32122;5646:54691" data-ir-name="<Radio>" sx={{ width: "44.4%", maxWidth: "40px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center" }} />
                        {/* @ir:end I1:65940;9445:27870;9445:32122;5646:54691 */}
                      </Stack>
                      {/* @ir:end I1:65940;9445:27870;9445:32122;5646:54690 */}
                    </Stack>
                    {/* @ir:end I1:65940;9445:27870;9445:32122;5646:54689 */}
                  </Stack>
                  {/* @ir:end I1:65940;9445:27870;9445:32122 */}
                </Stack>
                {/* @ir:end I1:65940;9445:27870 */}
              </Stack>
              {/* @ir:end 1:65940 */}
            </CardContent>
          </Card>
          {/* @ir:end 1:65930 */}
        </Stack>
        {/* @ir:end 1:65928 */}
        {/* @ir:start 2:656 <Stack> stack */}
        <Stack data-ir-id="2:656" data-ir-name="<Stack>" direction="column" spacing={0} sx={{ width: "100%", maxWidth: "960px", minHeight: "148px", display: "flex", flexDirection: "column", justifyContent: "center", pt: 4, pr: 2.5, pb: 2.5, pl: 2.5 }}>
          {/* @ir:start I2:656;4919:305782 <TextField> input */}
          <Controller data-ir-id="I2:656;4919:305782" data-ir-name="<TextField>"
            name={"_textfield__I2_656_4919_305782"}
            control={control}
            render={({ field: controllerField, fieldState }) => {
              const helperText = resolveFieldErrorMessage({
                fieldKey: "_textfield__I2_656_4919_305782",
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
                  aria-invalid={Boolean(helperText)}
                  aria-describedby={"_textfield__I2_656_4919_305782-helper-text"}
            sx={{
              width: "95.8%", maxWidth: "920px", minHeight: "96px", display: "flex", flexDirection: "column", gap: 1,
              "& .MuiOutlinedInput-root": { color: "text.secondary" },
              "& .MuiInputLabel-root": { color: "text.secondary" }
            }}

                  slotProps={{
                    htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "_textfield__I2_656_4919_305782-helper-text" },
              formHelperText: { id: "_textfield__I2_656_4919_305782-helper-text" }
                  }}
                />
              );
            }}
          />
          {/* @ir:end I2:656;4919:305782 */}
        </Stack>
        {/* @ir:end 2:656 */}
      </Stack>
      {/* @ir:end 2:1042 */}
      {/* @ir:start 1:67080 <Stack> ButtonCombination stack */}
      <Stack data-ir-id="1:67080" data-ir-name="<Stack> ButtonCombination" direction="row" spacing={0} sx={{ width: "100%", maxWidth: "960px", minHeight: "68px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", pt: 2.5 }}>
        {/* @ir:start I1:67080;32:73283 <Stack> stack */}
        <Stack data-ir-id="I1:67080;32:73283" data-ir-name="<Stack>" direction="row" spacing={2.5} sx={{ width: "100%", maxWidth: "960px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
          {/* @ir:start I1:67080;32:73283;23570:19637 <Button> button */}
          <Button data-ir-id="I1:67080;32:73283;23570:19637" data-ir-name="<Button>" variant="outlined" color="secondary" size="large" disableElevation type="button" sx={{ width: "41.7%", maxWidth: "400px", minHeight: "48px", display: "flex", flexDirection: "column", alignItems: "center", borderRadius: 8, color: "text.secondary", justifyContent: "center" }}>{"Abbrechen"}</Button>
          {/* @ir:end I1:67080;32:73283;23570:19637 */}
          {/* @ir:start I1:67080;32:73283;23570:19653 <Button> button */}
          <Button data-ir-id="I1:67080;32:73283;23570:19653" data-ir-name="<Button>" variant="contained" size="large" disabled={isSubmitting} disableElevation type="submit" sx={{ width: "41.7%", maxWidth: "400px", minHeight: "48px", display: "flex", flexDirection: "column", alignItems: "center", bgcolor: "secondary.main", borderRadius: 8, color: "background.default", justifyContent: "center" }}>{"Bedarf anlegen"}</Button>
          {/* @ir:end I1:67080;32:73283;23570:19653 */}
        </Stack>
        {/* @ir:end I1:67080;32:73283 */}
      </Stack>
      {/* @ir:end 1:67080 */}
    </Container>
  );
}

const sharedSxStyle1 = { width: "100%", maxWidth: "960px", minHeight: "24px", display: "flex", flexDirection: "row", alignItems: "center", px: 2.5 };
const sharedSxStyle2 = { height: "24px", color: "text.secondary", width: "2.5%", maxWidth: "24px", minHeight: "24px", flexDirection: "row", display: "flex", alignItems: "center", justifyContent: "center" };
const sharedSxStyle3 = { width: "95.8%", maxWidth: "918px", minHeight: "72px", display: "flex", flexDirection: "column" };

export default function SeitenContentScreen() {
  return (
      <SeitenContentPatternContextProvider initialState={patternContextInitialState}>
      <SeitenContentFormContextProvider>
      <SeitenContentScreenContent />
      </SeitenContentFormContextProvider>
      </SeitenContentPatternContextProvider>
  );
}
