import { Container, Typography } from "@mui/material";

export default function SettingsScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 1, py: 1 }}>
      {/* @ir:start set-title Title text */}
      <Typography data-ir-id="set-title" data-ir-name="Title" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Settings"}</Typography>
      {/* @ir:end set-title */}
      {/* @ir:start set-item1 Item text */}
      <Typography data-ir-id="set-item1" data-ir-name="Item" variant="body1" sx={{ fontWeight: 500, color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Notifications"}</Typography>
      {/* @ir:end set-item1 */}
      {/* @ir:start set-item2 Item text */}
      <Typography data-ir-id="set-item2" data-ir-name="Item" variant="body1" sx={{ fontWeight: 500, color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Privacy"}</Typography>
      {/* @ir:end set-item2 */}
    </Container>
  );
}
