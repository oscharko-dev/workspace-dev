import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Paper, Typography } from "@mui/material";

export default function HomeScreen() {
  const navigate = useNavigate();
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 1, py: 1 }}>
      <Typography variant="h1" component="h1" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Dashboard"}</Typography>
      <Paper role="button" tabIndex={0} onClick={() => navigate("/details")} onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate("/details"); } }} sx={{ position: "relative", width: "56.4%", maxWidth: "220px", minHeight: "48px", bgcolor: "primary.main" }}>
        <Typography variant="body1" sx={{ position: "absolute", left: "51px", top: "13px", fontWeight: 600, color: "background.default", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Open Details"}</Typography>
      </Paper>
    </Container>
  );
}
