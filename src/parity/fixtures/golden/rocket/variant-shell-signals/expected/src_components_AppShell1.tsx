import type { ReactNode } from "react";
import { Container, Stack, Typography } from "@mui/material";

export interface AppShell1Props {
  children: ReactNode;
  textOverrides?: Record<string, string>;
}

function AppShell1Content(props: Readonly<AppShell1Props>) {
  return (
    <Container id="app-shell" maxWidth="xl" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 2, py: 2 }}>
      {/* @ir:start 1:66050-header Header stack */}
      <Stack data-ir-id="1:66050-header" data-ir-name="Header" component="header" direction="row" spacing={0} role="banner" sx={{ width: "100%", maxWidth: "1336px", minHeight: "128px", display: "flex", flexDirection: "row", alignItems: "center" }}>
        {/* @ir:start 1:66050-title Title text */}
        <Typography data-ir-id="1:66050-title" data-ir-name="Title" component="h1" sx={{ whiteSpace: "pre-wrap" }}>{props.textOverrides?.["1:66050-title"] ?? "Bedarfsermittlung Investitionskredit"}</Typography>
        {/* @ir:end 1:66050-title */}
        {/* @ir:start 1:66050-mode Mode text */}
        <Typography data-ir-id="1:66050-mode" data-ir-name="Mode" sx={{ whiteSpace: "pre-wrap" }}>{props.textOverrides?.["1:66050-mode"] ?? "Netto"}</Typography>
        {/* @ir:end 1:66050-mode */}
      </Stack>
      {/* @ir:end 1:66050-header */}
      {props.children}
    </Container>
  );
}

export default function AppShell1(props: Readonly<AppShell1Props>) {
  return (
      <AppShell1Content>{props.children}</AppShell1Content>
  );
}
