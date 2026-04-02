import { useState } from "react";
import type { SyntheticEvent } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Box, Container, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

export default function SettingsScreen() {
  const [accordionState, setAccordionState] = useState<Record<string, boolean>>({
    "muiaccordionroot_accordion_section": true
  });

  const updateAccordionState = (accordionKey: string, expanded: boolean): void => {
    setAccordionState((previous) => ({ ...previous, [accordionKey]: expanded }));
  };

  const [tabValue1, setTabValue1] = useState<number>(0);

  const handleTabChange1 = (_event: SyntheticEvent, newValue: number): void => {
    setTabValue1(newValue);
  };
  return (
    <Container id="main-content" maxWidth="md" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 784px)", bgcolor: "#fafafc", px: 1.6, py: 1.6 }}>
      {/* @ir:start settings-title Title text */}
      <Typography data-ir-id="settings-title" data-ir-name="Title" variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Settings"}</Typography>
      {/* @ir:end settings-title */}
      {/* @ir:start tabs-container MuiTabsRoot tab */}
      <Tabs data-ir-id="tabs-container" data-ir-name="MuiTabsRoot" value={tabValue1} onChange={handleTabChange1} aria-label={"General"} sx={{ width: "96%", maxWidth: "768px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", bgcolor: "#ffffff" }}>
        <Tab key={"tab-general"} id={"tab-1-0"} value={0} label={"General"} />
        <Tab key={"tab-notifications"} id={"tab-1-1"} value={1} label={"Notifications"} />
        <Tab key={"tab-security"} id={"tab-1-2"} value={2} label={"Security"} />
      </Tabs>
      {/* @ir:end tabs-container */}
      {/* @ir:start accordion-section MuiAccordionRoot accordion */}
      <Accordion data-ir-id="accordion-section" data-ir-name="MuiAccordionRoot"
        expanded={accordionState["muiaccordionroot_accordion_section"] ?? true}
        onChange={(_, expanded) => updateAccordionState("muiaccordionroot_accordion_section", expanded)}
        disableGutters
        elevation={0}
        square
        sx={{ width: "96%", maxWidth: "768px", minHeight: "300px", display: "flex", flexDirection: "column", bgcolor: "#ffffff", borderRadius: 1, boxShadow: "none", "&::before": { display: "none" } }}
      >
        <AccordionSummary id={"accordion-header-muiaccordionroot_accordion_section"} aria-controls={"accordion-panel-muiaccordionroot_accordion_section"} expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: "56px" }}>
          <Box sx={{ width: "100%", position: "relative", minHeight: "56px" }}>
            {/* @ir:start acc-title-1 Title text */}
            <Typography data-ir-id="acc-title-1" data-ir-name="Title" variant="h3" component="h3" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Profile Information"}</Typography>
            {/* @ir:end acc-title-1 */}
          </Box>
        </AccordionSummary>
        <AccordionDetails id={"accordion-panel-muiaccordionroot_accordion_section"} role="region" aria-labelledby={"accordion-header-muiaccordionroot_accordion_section"} sx={{ p: 0 }}>
          <Box sx={{ position: "relative", width: "91.1%", maxWidth: "700px", minHeight: "22px", display: "block", flexDirection: "column" }}>
            <Box />
          </Box>
        </AccordionDetails>
      </Accordion>
      {/* @ir:end accordion-section */}
      {/* @ir:start dialog-trigger MuiDialogRoot table */}
      <Box data-ir-id="dialog-trigger" data-ir-name="MuiDialogRoot" sx={{ position: "relative", width: "50%", maxWidth: "400px", minHeight: "300px", bgcolor: "#ffffff", borderRadius: 1.5 }}>
        {/* @ir:start dialog-title Dialog Title text */}
        <Typography data-ir-id="dialog-title" data-ir-name="Dialog Title" variant="h2" component="h2" sx={{ position: "absolute", left: "24px", top: "24px", color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Confirm Changes"}</Typography>
        {/* @ir:end dialog-title */}
        {/* @ir:start dialog-body Dialog Body text */}
        <Typography data-ir-id="dialog-body" data-ir-name="Dialog Body" variant="body1" sx={{ position: "absolute", left: "24px", top: "68px", color: "text.primary", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Are you sure you want to save these changes? This action cannot be undone."}</Typography>
        {/* @ir:end dialog-body */}
        {/* @ir:start dialog-actions Actions stack */}
        <Stack data-ir-id="dialog-actions" data-ir-name="Actions" direction="row" spacing={1.2} sx={{ position: "absolute", left: "24px", top: "220px", width: "350px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", gap: 1.2 }}>
          {/* @ir:start cancel-label Label text */}
          <Typography data-ir-id="cancel-label" data-ir-name="Label" variant="body1" sx={{ fontWeight: 500, color: "text.primary", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Cancel"}</Typography>
          {/* @ir:end cancel-label */}
          {/* @ir:start dialog-confirm Confirm Button paper */}
          <Paper data-ir-id="dialog-confirm" data-ir-name="Confirm Button" sx={{ position: "relative", width: "25.1%", maxWidth: "88px", minHeight: "40px", bgcolor: "secondary.main", borderRadius: 1 }}>
            {/* @ir:start confirm-label Label text */}
            <Typography data-ir-id="confirm-label" data-ir-name="Label" variant="body1" sx={{ position: "absolute", left: "18px", top: "10px", fontWeight: 600, color: "#ffffff", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Confirm"}</Typography>
            {/* @ir:end confirm-label */}
          </Paper>
          {/* @ir:end dialog-confirm */}
        </Stack>
        {/* @ir:end dialog-actions */}
      </Box>
      {/* @ir:end dialog-trigger */}
    </Container>
  );
}
