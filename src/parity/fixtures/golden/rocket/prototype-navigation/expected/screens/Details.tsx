import { Container, Typography } from "@mui/material";

export default function DetailsScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 1, py: 1 }}>
      {/* @ir:start details-title Title text */}
      <Typography data-ir-id="details-title" data-ir-name="Title" variant="h2" component="h1" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Details"}</Typography>
      {/* @ir:end details-title */}
      {/* @ir:start details-body Body text */}
      <Typography data-ir-id="details-body" data-ir-name="Body" variant="body1" sx={{ color: "#383d47", textAlign: "left", whiteSpace: "pre-wrap" }}>{"A deterministic destination screen."}</Typography>
      {/* @ir:end details-body */}
    </Container>
  );
}
