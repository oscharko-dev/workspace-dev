import { Container, Typography } from "@mui/material";

export default function NotificationsScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 1, py: 1 }}>
      {/* @ir:start notif-title Title text */}
      <Typography data-ir-id="notif-title" data-ir-name="Title" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Notifications"}</Typography>
      {/* @ir:end notif-title */}
      {/* @ir:start notif-empty Empty State text */}
      <Typography data-ir-id="notif-empty" data-ir-name="Empty State" variant="body2" sx={{ color: "#999ea8", textAlign: "center", whiteSpace: "pre-wrap" }}>{"No new notifications"}</Typography>
      {/* @ir:end notif-empty */}
    </Container>
  );
}
