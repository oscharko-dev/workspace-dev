import { Container, Typography } from "@mui/material";

export default function FeedScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.paper", px: 1, py: 1 }}>
      {/* @ir:start feed-title Title text */}
      <Typography data-ir-id="feed-title" data-ir-name="Title" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Activity Feed"}</Typography>
      {/* @ir:end feed-title */}
    </Container>
  );
}
