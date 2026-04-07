import { Card, CardContent, Container, Typography } from "@mui/material";

export default function DashboardLightScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.paper", px: 1.143, py: 1.143 }}>
      {/* @ir:start light-title Heading text */}
      <Typography data-ir-id="light-title" data-ir-name="Heading" variant="h1" component="h1" sx={{ color: "#1c1f24", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Operations Dashboard"}</Typography>
      {/* @ir:end light-title */}
      {/* @ir:start light-body Body text */}
      <Typography data-ir-id="light-body" data-ir-name="Body" variant="body1" sx={{ color: "#545c66", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Track shipment delays, alerts, and approvals in one place."}</Typography>
      {/* @ir:end light-body */}
      {/* @ir:start light-summary-card Summary Card card */}
      <Card data-ir-id="light-summary-card" data-ir-name="Summary Card" component="article" sx={{ width: "87.7%", maxWidth: "342px", minHeight: "144px", display: "flex", flexDirection: "column", gap: 0.571, p: 1.143, bgcolor: "background.paper" }}>
        <CardContent>
          {/* @ir:start light-card-title Label text */}
          <Typography data-ir-id="light-card-title" data-ir-name="Label" variant="body2" sx={{ color: "#666b75", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Open incidents"}</Typography>
          {/* @ir:end light-card-title */}
          {/* @ir:start light-card-value Value text */}
          <Typography data-ir-id="light-card-value" data-ir-name="Value" variant="h2" component="h2" sx={{ color: "#1c1f24", textAlign: "left", whiteSpace: "pre-wrap" }}>{"14 urgent reviews"}</Typography>
          {/* @ir:end light-card-value */}
        </CardContent>
      </Card>
      {/* @ir:end light-summary-card */}
    </Container>
  );
}
