import { Container, Typography } from "@mui/material";

export default function AboutScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 1, py: 1 }}>
      {/* @ir:start about-title Title text */}
      <Typography data-ir-id="about-title" data-ir-name="Title" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"About"}</Typography>
      {/* @ir:end about-title */}
      {/* @ir:start about-version Version text */}
      <Typography data-ir-id="about-version" data-ir-name="Version" variant="body2" sx={{ color: "#666b75", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Version 2.1.0"}</Typography>
      {/* @ir:end about-version */}
      {/* @ir:start about-body Body text */}
      <Typography data-ir-id="about-body" data-ir-name="Body" variant="body1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Built with care by the engineering team."}</Typography>
      {/* @ir:end about-body */}
    </Container>
  );
}
