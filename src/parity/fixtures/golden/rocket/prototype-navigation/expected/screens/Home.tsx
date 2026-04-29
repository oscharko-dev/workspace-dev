import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Paper, Typography } from "@mui/material";

export default function HomeScreen() {
  const navigate = useNavigate();
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 1, py: 1 }}>
      {/* @ir:start home-title Title text */}
      <Typography data-ir-id="home-title" data-ir-name="Title" variant="h1" component="h1" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Dashboard"}</Typography>
      {/* @ir:end home-title */}
      {/* @ir:start nav-button Open Details Button paper */}
      <Paper data-ir-id="nav-button" data-ir-name="Open Details Button" role="button" tabIndex={0} onClick={() => { void navigate("\u002Fdetails"); }} onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void navigate("\u002Fdetails"); } }} sx={{ position: "relative", width: "56.4%", maxWidth: "220px", minHeight: "48px", bgcolor: "primary.main" }}>
        {/* @ir:start nav-button-text Label text */}
        <Typography data-ir-id="nav-button-text" data-ir-name="Label" variant="body1" sx={{ position: "absolute", left: "51px", top: "13px", fontWeight: 600, color: "background.default", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Open Details"}</Typography>
        {/* @ir:end nav-button-text */}
      </Paper>
      {/* @ir:end nav-button */}
    </Container>
  );
}
