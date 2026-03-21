import { Avatar, Badge, Box, Chip, Container, Divider, Stack, Typography } from "@mui/material";
import { ProfilePattern1 } from "../components/ProfilePattern1";
import { ProfilePatternContextProvider, type ProfilePatternContextState } from "../context/ProfilePatternContext";

const patternContextInitialState: ProfilePatternContextState = {
  "ProfilePattern1": {
    "stats-card-1": {
      "labelText": "Projects",
      "valueText": "42"
    },
    "stats-card-2": {
      "labelText": "Contributions",
      "valueText": "1,284"
    },
    "stats-card-3": {
      "labelText": "Reviews",
      "valueText": "89"
    }
  }
};

function ProfileScreenContent() {
  return (
    <Container id="main-content" maxWidth="md" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 401px)", bgcolor: "#f7f7fa", px: 2, py: 2 }}>
      {/* @ir:start profile-title Title text */}
      <Typography data-ir-id="profile-title" data-ir-name="Title" variant="h2" component="h4" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"User Profile"}</Typography>
      {/* @ir:end profile-title */}
      {/* @ir:start avatar-section Avatar Section avatar */}
      <Avatar data-ir-id="avatar-section" data-ir-name="Avatar Section" sx={{ width: "94%", maxWidth: "752px", minHeight: "80px", display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>{"Jane Smith"}</Avatar>
      {/* @ir:end avatar-section */}
      {/* @ir:start stats-card-1 Stats Card card extracted */}
      <ProfilePattern1 data-ir-id="stats-card-1" data-ir-name="Stats Card" sx={sharedSxStyle1} instanceId={"stats-card-1"} />
      {/* @ir:end stats-card-1 */}
      {/* @ir:start stats-card-2 Stats Card card extracted */}
      <ProfilePattern1 data-ir-id="stats-card-2" data-ir-name="Stats Card" sx={sharedSxStyle1} instanceId={"stats-card-2"} />
      {/* @ir:end stats-card-2 */}
      {/* @ir:start stats-card-3 Stats Card card extracted */}
      <ProfilePattern1 data-ir-id="stats-card-3" data-ir-name="Stats Card" sx={sharedSxStyle1} instanceId={"stats-card-3"} />
      {/* @ir:end stats-card-3 */}
      {/* @ir:start divider-1 MuiDividerRoot divider */}
      <Divider data-ir-id="divider-1" data-ir-name="MuiDividerRoot" aria-hidden="true" sx={{ width: "752px", height: "1px" }} />
      {/* @ir:end divider-1 */}
      {/* @ir:start chip-section Skills stack */}
      <Stack data-ir-id="chip-section" data-ir-name="Skills" direction="row" spacing={1} sx={{ width: "94%", maxWidth: "752px", minHeight: "40px", display: "flex", flexDirection: "row", alignItems: "center", gap: 1 }}>
        {/* @ir:start chip-1 MuiChipRoot chip */}
        <Chip data-ir-id="chip-1" data-ir-name="MuiChipRoot" label={"React"} sx={{ position: "relative", width: "10.6%", maxWidth: "80px", minHeight: "32px" }} />
        {/* @ir:end chip-1 */}
        {/* @ir:start chip-2 MuiChipRoot chip */}
        <Chip data-ir-id="chip-2" data-ir-name="MuiChipRoot" label={"TypeScript"} sx={{ position: "relative", width: "13.3%", maxWidth: "100px", minHeight: "32px" }} />
        {/* @ir:end chip-2 */}
        {/* @ir:start chip-3 MuiChipRoot chip */}
        <Chip data-ir-id="chip-3" data-ir-name="MuiChipRoot" label={"Node.js"} sx={{ position: "relative", width: "10.6%", maxWidth: "80px", minHeight: "32px" }} />
        {/* @ir:end chip-3 */}
        {/* @ir:start chip-4 MuiChipRoot chip */}
        <Chip data-ir-id="chip-4" data-ir-name="MuiChipRoot" label={"PostgreSQL"} sx={{ position: "relative", width: "13.3%", maxWidth: "100px", minHeight: "32px" }} />
        {/* @ir:end chip-4 */}
      </Stack>
      {/* @ir:end chip-section */}
      {/* @ir:start badge-item MuiBadgeRoot badge */}
      <Badge data-ir-id="badge-item" data-ir-name="MuiBadgeRoot" badgeContent={"3"} color="primary" sx={{ position: "relative", width: "6%", maxWidth: "48px", minHeight: "48px" }}>
        {/* @ir:start badge-icon Icon container */}
        <Box data-ir-id="badge-icon" data-ir-name="Icon" aria-hidden="true" sx={{ position: "absolute", left: "0px", top: "0px", width: "40px", height: "40px", bgcolor: "#d9d9d9" }} />
        {/* @ir:end badge-icon */}
        {/* @ir:start badge-count Badge badge */}
        <Badge data-ir-id="badge-count" data-ir-name="Badge" badgeContent={"3"} color="primary" sx={{ position: "absolute", left: "28px", top: "0px", width: "20px", minHeight: "20px" }}>
          {/* @ir:start badge-text Count text */}
          <Typography data-ir-id="badge-text" data-ir-name="Count" variant="caption" sx={{ position: "absolute", left: "6px", top: "2px", color: "#ffffff", textAlign: "center", whiteSpace: "pre-wrap" }}>{"3"}</Typography>
          {/* @ir:end badge-text */}
        </Badge>
        {/* @ir:end badge-count */}
      </Badge>
      {/* @ir:end badge-item */}
    </Container>
  );
}

const sharedSxStyle1 = { width: "30%", maxWidth: "240px", minHeight: "120px", display: "flex", flexDirection: "column", gap: 1, bgcolor: "#ffffff", borderRadius: 0.75 };

export default function ProfileScreen() {
  return (
      <ProfilePatternContextProvider initialState={patternContextInitialState}>
      <ProfileScreenContent />
      </ProfilePatternContextProvider>
  );
}
