import { Avatar, Container, Typography } from "@mui/material";

export default function ProfileScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.paper", px: 1, py: 1 }}>
      {/* @ir:start prof-title Title text */}
      <Typography data-ir-id="prof-title" data-ir-name="Title" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"My Profile"}</Typography>
      {/* @ir:end prof-title */}
      {/* @ir:start prof-avatar Avatar avatar */}
      <Avatar data-ir-id="prof-avatar" data-ir-name="Avatar" sx={{ bgcolor: "#d9d9e6" }}></Avatar>
      {/* @ir:end prof-avatar */}
    </Container>
  );
}
