import { Container, Typography } from "@mui/material";

export default function HomeScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.paper", px: 1, py: 1 }}>
      {/* @ir:start home-greeting Greeting text */}
      <Typography data-ir-id="home-greeting" data-ir-name="Greeting" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Good Morning"}</Typography>
      {/* @ir:end home-greeting */}
      {/* @ir:start home-subtitle Subtitle text */}
      <Typography data-ir-id="home-subtitle" data-ir-name="Subtitle" variant="body2" component="h2" sx={{ color: "text.secondary", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Here is your daily summary"}</Typography>
      {/* @ir:end home-subtitle */}
    </Container>
  );
}
