import type { ReactNode } from "react";
import { Box, Container, Paper, Stack } from "@mui/material";

export interface AppShell1Props {
  children: ReactNode;
}

function AppShell1Content(props: Readonly<AppShell1Props>) {
  return (
    <Container id="app-shell" maxWidth="xl" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 1.6, py: 1.6 }}>
      {/* @ir:start 1:67465 Markenbühne paper */}
      <Paper data-ir-id="1:67465" data-ir-name="Markenbühne" variant="outlined" aria-hidden="true" sx={{ width: "1336px", height: "88px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 3.2, px: 3.2, bgcolor: "#ee0000", border: "1px solid", borderColor: "#d40000" }} />
      {/* @ir:end 1:67465 */}
      {/* @ir:start 1:67466 Header + Titel stack */}
      <Stack data-ir-id="1:67466" data-ir-name="Header + Titel" component="header" direction="column" spacing={0} role="banner" aria-hidden="true" sx={{ width: "100%", maxWidth: "1336px", minHeight: "164px", display: "flex", flexDirection: "column", alignItems: "center", pb: 1.2 }}>
        {/* @ir:start 1:67467 Header container */}
        <Box data-ir-id="1:67467" data-ir-name="Header" component="header" role="banner" aria-hidden="true" sx={{ width: "1336px", height: "96px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", py: 2.4, px: 3.2, bgcolor: "background.default" }} />
        {/* @ir:end 1:67467 */}
      </Stack>
      {/* @ir:end 1:67466 */}
      {props.children}
    </Container>
  );
}

export default function AppShell1(props: Readonly<AppShell1Props>) {
  return (
      <AppShell1Content>{props.children}</AppShell1Content>
  );
}
