import { Container, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";

export default function DashboardScreen() {
  return (
    <Container id="main-content" maxWidth="lg" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 352px)", bgcolor: "background.paper", px: 2, py: 2 }}>
      {/* @ir:start header Title text */}
      <Typography data-ir-id="header" data-ir-name="Title" variant="h2" component="h3" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Dashboard"}</Typography>
      {/* @ir:end header */}
      {/* @ir:start card-container Cards Grid table */}
      <Table data-ir-id="card-container" data-ir-name="Cards Grid" size="small" sx={{ width: "96.9%", maxWidth: "992px", minHeight: "300px", display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-start", gap: 2 }}>
        <TableHead>
          <TableRow>
            <TableCell>{"Revenue"}</TableCell>
            <TableCell>{"$42,500"}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>{"Users"}</TableCell>
            <TableCell>{"1,250"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {/* @ir:end card-container */}
    </Container>
  );
}
