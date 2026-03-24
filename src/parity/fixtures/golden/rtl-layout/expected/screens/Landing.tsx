import { Box, Container, Paper, Stack, Typography } from "@mui/material";

const sharedSxStyle1 = { color: "primary.main", textAlign: "right", whiteSpace: "pre-wrap" };
const sharedSxStyle2 = { color: "secondary.main", textAlign: "right", whiteSpace: "pre-wrap" };

export default function LandingScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 404px)", bgcolor: "#ffffff", px: 1.333, py: 1.333 }}>
      {/* @ir:start rtl-heading Title text */}
      <Typography data-ir-id="rtl-heading" data-ir-name="Title" variant="h1" component="h1" sx={sharedSxStyle1}>{"مرحباً بكم"}</Typography>
      {/* @ir:end rtl-heading */}
      {/* @ir:start rtl-subtitle Subtitle text */}
      <Typography data-ir-id="rtl-subtitle" data-ir-name="Subtitle" variant="h3" component="h4" sx={sharedSxStyle2}>{"اكتشف أفضل المنتجات والخدمات"}</Typography>
      {/* @ir:end rtl-subtitle */}
      {/* @ir:start rtl-card-1 Feature Card table */}
      <Box data-ir-id="rtl-card-1" data-ir-name="Feature Card" component="article" aria-hidden="true" sx={{ width: "87.7%", maxWidth: "342px", minHeight: "100px", display: "flex", flexDirection: "row", alignItems: "center", gap: 1, bgcolor: "#f5f7fa", borderRadius: 1.5 }}>
        {/* @ir:start rtl-card1-text Content stack */}
        <Stack data-ir-id="rtl-card1-text" data-ir-name="Content" component="main" direction="column" spacing={0.333} role="main" aria-hidden="true" sx={{ width: "73.1%", maxWidth: "250px", minHeight: "76px", display: "flex", flexDirection: "column", gap: 0.333 }}>
          {/* @ir:start rtl-card1-title Card Title text */}
          <Typography data-ir-id="rtl-card1-title" data-ir-name="Card Title" variant="h2" component="h2" sx={sharedSxStyle1}>{"التصميم الاحترافي"}</Typography>
          {/* @ir:end rtl-card1-title */}
          {/* @ir:start rtl-card1-desc Description text */}
          <Typography data-ir-id="rtl-card1-desc" data-ir-name="Description" variant="body1" sx={sharedSxStyle2}>{"نقدم تصاميم عصرية ومبتكرة"}</Typography>
          {/* @ir:end rtl-card1-desc */}
        </Stack>
        {/* @ir:end rtl-card1-text */}
        {/* @ir:start rtl-card1-icon Icon container */}
        <Box data-ir-id="rtl-card1-icon" data-ir-name="Icon" aria-hidden="true" sx={{ width: "44px", height: "44px", bgcolor: "info.main", borderRadius: 1 }} />
        {/* @ir:end rtl-card1-icon */}
      </Box>
      {/* @ir:end rtl-card-1 */}
      {/* @ir:start rtl-card-2 Feature Card table */}
      <Box data-ir-id="rtl-card-2" data-ir-name="Feature Card" component="article" aria-hidden="true" sx={{ width: "87.7%", maxWidth: "342px", minHeight: "100px", display: "flex", flexDirection: "row", alignItems: "center", gap: 1, bgcolor: "#f5f7fa", borderRadius: 1.5 }}>
        {/* @ir:start rtl-card2-text Content stack */}
        <Stack data-ir-id="rtl-card2-text" data-ir-name="Content" component="main" direction="column" spacing={0.333} role="main" aria-hidden="true" sx={{ width: "73.1%", maxWidth: "250px", minHeight: "76px", display: "flex", flexDirection: "column", gap: 0.333 }}>
          {/* @ir:start rtl-card2-title Card Title text */}
          <Typography data-ir-id="rtl-card2-title" data-ir-name="Card Title" variant="h2" component="h3" sx={sharedSxStyle1}>{"الدعم الفني"}</Typography>
          {/* @ir:end rtl-card2-title */}
          {/* @ir:start rtl-card2-desc Description text */}
          <Typography data-ir-id="rtl-card2-desc" data-ir-name="Description" variant="body1" sx={sharedSxStyle2}>{"فريق متخصص لمساعدتك"}</Typography>
          {/* @ir:end rtl-card2-desc */}
        </Stack>
        {/* @ir:end rtl-card2-text */}
        {/* @ir:start rtl-card2-icon Icon container */}
        <Box data-ir-id="rtl-card2-icon" data-ir-name="Icon" aria-hidden="true" sx={{ width: "44px", height: "44px", bgcolor: "success.main", borderRadius: 1 }} />
        {/* @ir:end rtl-card2-icon */}
      </Box>
      {/* @ir:end rtl-card-2 */}
      {/* @ir:start rtl-cta CTA Button paper */}
      <Paper data-ir-id="rtl-cta" data-ir-name="CTA Button" aria-hidden="true" sx={{ position: "relative", width: "87.7%", maxWidth: "342px", minHeight: "48px", bgcolor: "info.main", borderRadius: 1 }}>
        {/* @ir:start rtl-cta-label Label text */}
        <Typography data-ir-id="rtl-cta-label" data-ir-name="Label" variant="subtitle1" sx={{ position: "absolute", left: "126px", top: "12px", lineHeight: "1.5rem", color: "#ffffff", textAlign: "center", whiteSpace: "pre-wrap" }}>{"ابدأ الآن"}</Typography>
        {/* @ir:end rtl-cta-label */}
      </Paper>
      {/* @ir:end rtl-cta */}
    </Container>
  );
}
