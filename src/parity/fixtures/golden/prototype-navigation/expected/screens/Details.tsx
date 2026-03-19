import { Container, Typography } from "@mui/material";

export default function DetailsScreen() {
  return (
    <Container maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 1, py: 1 }}>
      <Typography variant="h2" component="h1" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Details"}</Typography>
      <Typography variant="body1" sx={{ color: "#383d47", textAlign: "left", whiteSpace: "pre-wrap" }}>{"A deterministic destination screen."}</Typography>
    </Container>
  );
}
