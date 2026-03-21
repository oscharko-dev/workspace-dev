import { Container, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";

export default function DashboardScreen() {
  return (
    <Container id="main-content" maxWidth="lg" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 660px)", bgcolor: "#f5f7fa", px: 0.667, py: 0.667 }}>
      {/* @ir:start dash-title Title text */}
      <Typography data-ir-id="dash-title" data-ir-name="Title" variant="h2" component="h4" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Dashboard Overview"}</Typography>
      {/* @ir:end dash-title */}
      {/* @ir:start cards-grid Cards Grid table */}
      <Table data-ir-id="cards-grid" data-ir-name="Cards Grid" size="small" sx={{ position: "relative", width: "96%", maxWidth: "1152px", minHeight: "600px" }}>
        <TableHead>
          <TableRow>
            <TableCell>{"Revenue"}</TableCell>
            <TableCell>{"$45,231"}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>{"Active Users"}</TableCell>
            <TableCell>{"2,350"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{"Pending Orders"}</TableCell>
            <TableCell>{"127"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{"Sales Overview"}</TableCell>
            <TableCell>{"Monthly revenue trends"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{"Recent Activity"}</TableCell>
            <TableCell>{"Last 7 days"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {/* @ir:end cards-grid */}
    </Container>
  );
}
