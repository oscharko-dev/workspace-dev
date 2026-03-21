import { Container, Typography } from "@mui/material";

export default function OnboardingScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 1, py: 1 }}>
      {/* @ir:start onb-title Title text */}
      <Typography data-ir-id="onb-title" data-ir-name="Title" variant="h2" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Welcome"}</Typography>
      {/* @ir:end onb-title */}
      {/* @ir:start onb-body Body text */}
      <Typography data-ir-id="onb-body" data-ir-name="Body" variant="body1" sx={{ color: "#666b75", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Let us set up your account in a few easy steps."}</Typography>
      {/* @ir:end onb-body */}
    </Container>
  );
}
