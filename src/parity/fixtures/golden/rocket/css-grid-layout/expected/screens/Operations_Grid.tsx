import { Box, Container, Typography } from "@mui/material";

export default function OperationsGridScreen() {
  return (
    <Container id="main-content" maxWidth="lg" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 638px)", bgcolor: "background.paper", px: 0.8, py: 0.8 }}>
      {/* @ir:start grid-title Heading text */}
      <Typography data-ir-id="grid-title" data-ir-name="Heading" variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Warehouse Operations"}</Typography>
      {/* @ir:end grid-title */}
      {/* @ir:start grid-subtitle Subtitle text */}
      <Typography data-ir-id="grid-subtitle" data-ir-name="Subtitle" variant="h5" component="h6" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Monitor intake, throughput, and dock utilization across shifts."}</Typography>
      {/* @ir:end grid-subtitle */}
      {/* @ir:start analytics-matrix Analytics Matrix grid */}
      <Box data-ir-id="analytics-matrix" data-ir-name="Analytics Matrix" sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto auto auto", gap: 2, position: "relative", width: "95.1%", maxWidth: "932px", minHeight: "540px" }}>
        <Box sx={{ gridRow: "1 / 3" }}>
          {/* @ir:start grid-area-nav grid-area-nav grid */}
          <Box data-ir-id="grid-area-nav" data-ir-name="grid-area-nav" sx={{ position: "absolute", left: "0px", top: "0px", width: "220px", minHeight: "324px", bgcolor: "background.paper", borderRadius: 1 }}>
            {/* @ir:start grid-area-nav-text Label text */}
            <Typography data-ir-id="grid-area-nav-text" data-ir-name="Label" variant="h4" component="h4" sx={{ position: "absolute", left: "24px", top: "24px", fontWeight: 600, color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Shift filters"}</Typography>
            {/* @ir:end grid-area-nav-text */}
          </Box>
          {/* @ir:end grid-area-nav */}
        </Box>
          {/* @ir:start grid-area-hero grid-area-hero grid */}
          <Box data-ir-id="grid-area-hero" data-ir-name="grid-area-hero" component="header" role="banner" sx={{ position: "absolute", left: "236px", top: "0px", width: "696px", minHeight: "192px", bgcolor: "background.paper", borderRadius: 1 }}>
            {/* @ir:start grid-area-hero-text Label text */}
            <Typography data-ir-id="grid-area-hero-text" data-ir-name="Label" variant="h2" component="h2" sx={{ position: "absolute", left: "24px", top: "24px", color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Dock turnaround dropped 18% this week"}</Typography>
            {/* @ir:end grid-area-hero-text */}
          </Box>
          {/* @ir:end grid-area-hero */}
          {/* @ir:start grid-area-stats grid-area-stats grid */}
          <Box data-ir-id="grid-area-stats" data-ir-name="grid-area-stats" sx={{ position: "absolute", left: "236px", top: "208px", width: "696px", minHeight: "116px", bgcolor: "background.paper", borderRadius: 1 }}>
            {/* @ir:start grid-area-stats-text Label text */}
            <Typography data-ir-id="grid-area-stats-text" data-ir-name="Label" variant="h3" component="h3" sx={{ position: "absolute", left: "24px", top: "32px", color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"96 inbound loads processed before noon"}</Typography>
            {/* @ir:end grid-area-stats-text */}
          </Box>
          {/* @ir:end grid-area-stats */}
        <Box sx={{ gridColumn: "1 / 3" }}>
          {/* @ir:start grid-area-footer grid-area-footer grid */}
          <Box data-ir-id="grid-area-footer" data-ir-name="grid-area-footer" component="footer" role="contentinfo" sx={{ position: "absolute", left: "0px", top: "340px", width: "932px", minHeight: "136px", bgcolor: "background.paper", borderRadius: 1 }}>
            {/* @ir:start grid-area-footer-text Label text */}
            <Typography data-ir-id="grid-area-footer-text" data-ir-name="Label" variant="h4" component="h5" sx={{ position: "absolute", left: "24px", top: "54px", color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Supervisors are reviewing six delayed outbound loads."}</Typography>
            {/* @ir:end grid-area-footer-text */}
          </Box>
          {/* @ir:end grid-area-footer */}
        </Box>
      </Box>
      {/* @ir:end analytics-matrix */}
    </Container>
  );
}
