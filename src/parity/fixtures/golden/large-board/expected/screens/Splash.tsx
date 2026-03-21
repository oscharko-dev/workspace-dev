import { Container, Typography } from "@mui/material";

export default function SplashScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#265cf5", px: 1, py: 1 }}>
      {/* @ir:start splash-title Title text */}
      <Typography data-ir-id="splash-title" data-ir-name="Title" variant="h1" component="h1" sx={{ color: "#ffffff", textAlign: "center", whiteSpace: "pre-wrap" }}>{"AppName"}</Typography>
      {/* @ir:end splash-title */}
      {/* @ir:start splash-tagline Tagline text */}
      <Typography data-ir-id="splash-tagline" data-ir-name="Tagline" variant="body1" sx={{ color: "#d9e6ff", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Your digital companion"}</Typography>
      {/* @ir:end splash-tagline */}
    </Container>
  );
}
