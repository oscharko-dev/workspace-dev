import { Card, CardContent, Container, Typography } from "@mui/material";

export default function DashboardDarkScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#12141c", px: 1.143, py: 1.143 }}>
      {/* @ir:start dark-title Heading text */}
      <Typography data-ir-id="dark-title" data-ir-name="Heading" variant="h1" component="h1" sx={{ color: "#f5f7fa", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Operations Dashboard"}</Typography>
      {/* @ir:end dark-title */}
      {/* @ir:start dark-body Body text */}
      <Typography data-ir-id="dark-body" data-ir-name="Body" variant="body1" sx={{ color: "#b3bac7", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Track shipment delays, alerts, and approvals in one place."}</Typography>
      {/* @ir:end dark-body */}
      {/* @ir:start dark-summary-card Summary Card card */}
      <Card data-ir-id="dark-summary-card" data-ir-name="Summary Card" component="article" sx={{ width: "87.7%", maxWidth: "342px", minHeight: "144px", display: "flex", flexDirection: "column", gap: 0.571, p: 1.143, bgcolor: "#1f242e" }}>
        <CardContent>
          {/* @ir:start dark-card-title Label text */}
          <Typography data-ir-id="dark-card-title" data-ir-name="Label" variant="body2" sx={{ color: "#a6adba", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Open incidents"}</Typography>
          {/* @ir:end dark-card-title */}
          {/* @ir:start dark-card-value Value text */}
          <Typography data-ir-id="dark-card-value" data-ir-name="Value" variant="h2" component="h2" sx={{ color: "#f5f7fa", textAlign: "left", whiteSpace: "pre-wrap" }}>{"14 urgent reviews"}</Typography>
          {/* @ir:end dark-card-value */}
        </CardContent>
      </Card>
      {/* @ir:end dark-summary-card */}
    </Container>
  );
}
