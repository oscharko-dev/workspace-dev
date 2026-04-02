import { Box, Container, Typography } from "@mui/material";
import AppShell1 from "../components/AppShell1";

function ID0031FehlermeldungenScreenContent() {
  return (
    <Container id="main-content" maxWidth={false} disableGutters role="main" sx={{ position: "relative", width: "100%" }}>
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

export default function ID0031FehlermeldungenScreen() {
  return (
      <AppShell1>
        <ID0031FehlermeldungenScreenContent />
      </AppShell1>
  );
}
