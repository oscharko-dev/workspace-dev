import { Box, Container, List, ListItem, ListItemText, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import { HomeDesktopPatternContextProvider, type HomeDesktopPatternContextState } from "../context/HomeDesktopPatternContext";

const patternContextInitialState: HomeDesktopPatternContextState = {
  "HomeDesktopPattern1": {
    "feature-1": {
      "featureDescriptionText": "Deploy your apps in seconds with our streamlined pipeline.",
      "featureTitleText": "Fast Deployment"
    },
    "feature-2": {
      "featureDescriptionText": "Work together in real-time with powerful collaboration tools.",
      "featureTitleText": "Team Collaboration"
    },
    "feature-3": {
      "featureDescriptionText": "Gain insights with comprehensive analytics and reporting.",
      "featureTitleText": "Analytics Dashboard"
    }
  }
};

function HomeDesktopScreenContent() {
  return (
    <Container id="main-content" maxWidth="xl" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 724px)", bgcolor: "#ffffff", px: 1.333, py: 1.333, maxWidth: { xs: "390px", sm: "none", lg: "1440px", xl: "none" }, gap: { xs: 1.333, sm: 2 } }}>
      {/* @ir:start hero-desktop Hero Section table */}
      <Box data-ir-id="hero-desktop" data-ir-name="Hero Section" component="header" role="banner" sx={{ width: "93.3%", maxWidth: "1344px", minHeight: "400px", display: "flex", flexDirection: "row", alignItems: "center", gap: 2.667 }}>
        {/* @ir:start hero-text-desktop Hero Text list */}
        <List data-ir-id="hero-text-desktop" data-ir-name="Hero Text" sx={{ width: "48.4%", maxWidth: "650px", minHeight: "400px", display: "flex", flexDirection: "column", gap: 1.333 }}>
          <ListItem key={"hero-heading-desktop"} disablePadding><ListItemText primary={"Build Better Products"} /></ListItem>
          <ListItem key={"hero-body-desktop"} disablePadding><ListItemText primary={"Our platform helps teams collaborate and deliver exceptional results."} /></ListItem>
          <ListItem key={"hero-cta-desktop"} disablePadding><ListItemText primary={"Get Started"} /></ListItem>
        </List>
        {/* @ir:end hero-text-desktop */}
        {/* @ir:start hero-image-desktop Hero Image image */}
        <Box data-ir-id="hero-image-desktop" data-ir-name="Hero Image" component="img" src={"data:image\u002Fsvg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20662%20400%22%20width%3D%22662%22%20height%3D%22400%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%22662%22%20height%3D%22400%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EHero%20Image%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Hero Image"} decoding="async" fetchPriority="high" width={662} height={400} sx={{ width: "662px", height: "400px", borderRadius: 1.5, objectFit: "cover", display: "block" }} />
        {/* @ir:end hero-image-desktop */}
      </Box>
      {/* @ir:end hero-desktop */}
      {/* @ir:start features-desktop Features Section table */}
      <Table data-ir-id="features-desktop" data-ir-name="Features Section" size="small" sx={{ maxWidth: "1344px", display: "flex", alignItems: "center", flexDirection: { xs: "column", sm: "row" }, gap: { xs: 1, sm: 2 }, width: { xs: "91.8%", sm: "93.3%" }, minHeight: { xs: "600px", sm: "300px" } }}>
        <TableHead>
          <TableRow>
            <TableCell>{"Fast Deployment"}</TableCell>
            <TableCell>{"Deploy your apps in seconds with our streamlined pipeline."}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>{"Team Collaboration"}</TableCell>
            <TableCell>{"Work together in real-time with powerful collaboration tools."}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{"Analytics Dashboard"}</TableCell>
            <TableCell>{"Gain insights with comprehensive analytics and reporting."}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {/* @ir:end features-desktop */}
    </Container>
  );
}

export default function HomeDesktopScreen() {
  return (
      <HomeDesktopPatternContextProvider initialState={patternContextInitialState}>
      <HomeDesktopScreenContent />
      </HomeDesktopPatternContextProvider>
  );
}
