import { useState } from "react";
import type { SyntheticEvent } from "react";
import { Box, Container, Tab, Tabs, Typography } from "@mui/material";

const sharedSxStyle1 = { fontWeight: 600, color: "#666b75", textAlign: "left", whiteSpace: "pre-wrap" };

export default function UserListScreen() {
  const [tabValue1, setTabValue1] = useState<number>(0);

  const handleTabChange1 = (_event: SyntheticEvent, newValue: number): void => {
    setTabValue1(newValue);
  };

  const [tabValue2, setTabValue2] = useState<number>(0);

  const handleTabChange2 = (_event: SyntheticEvent, newValue: number): void => {
    setTabValue2(newValue);
  };
  return (
    <Container id="main-content" maxWidth="md" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 2, py: 2 }}>
      <Typography variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Users"}</Typography>
      <Box sx={{ width: "96%", maxWidth: "768px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", bgcolor: "#f5f5f7" }}>
        <Typography variant="body1" sx={sharedSxStyle1}>{"Name"}</Typography>
        <Typography variant="body1" sx={sharedSxStyle1}>{"Email"}</Typography>
        <Typography variant="body1" sx={sharedSxStyle1}>{"Role"}</Typography>
        <Typography variant="body1" sx={sharedSxStyle1}>{"Status"}</Typography>
      </Box>
      <Tabs value={tabValue1} onChange={handleTabChange1} aria-label={"Alice Johnson"} sx={{ width: "96%", maxWidth: "768px", minHeight: "52px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Tab key={"row1-name"} id={"tab-1-0"} value={0} label={"Alice Johnson"} />
        <Tab key={"row1-email"} id={"tab-1-1"} value={1} label={"alice@example.com"} />
        <Tab key={"row1-role"} id={"tab-1-2"} value={2} label={"Admin"} />
        <Tab key={"row1-status"} id={"tab-1-3"} value={3} label={"Active"} />
      </Tabs>
      <Tabs value={tabValue2} onChange={handleTabChange2} aria-label={"Bob Smith"} sx={{ width: "96%", maxWidth: "768px", minHeight: "52px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Tab key={"row2-name"} id={"tab-2-0"} value={0} label={"Bob Smith"} />
        <Tab key={"row2-email"} id={"tab-2-1"} value={1} label={"bob@example.com"} />
        <Tab key={"row2-role"} id={"tab-2-2"} value={2} label={"Editor"} />
        <Tab key={"row2-status"} id={"tab-2-3"} value={3} label={"Pending"} />
      </Tabs>
    </Container>
  );
}
