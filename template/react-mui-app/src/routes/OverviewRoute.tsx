import {
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";

const metrics = [
  { label: "Initial JavaScript", target: "≤ 180 KB", value: "Lazy route chunks excluded from first paint" },
  { label: "Interaction to Next Paint", target: "≤ 200 ms", value: "Tracked via INP with fallback proxies" },
  { label: "Route transition", target: "≤ 300 ms", value: "Lab proxy based on interactive / TBT" }
] as const;

export default function OverviewRoute() {
  return (
    <Stack component="main" id="main-content" spacing={3}>
      <Stack spacing={1.25}>
        <Chip color="primary" label="Lazy route" sx={{ alignSelf: "flex-start" }} />
        <Typography variant="h4">Overview dashboard</Typography>
        <Typography color="text.secondary" maxWidth={760} variant="body1">
          This route deliberately lives behind a lazy boundary so the template can prove code splitting, route warmup,
          and budget enforcement against a realistic navigation path.
        </Typography>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 4,
          p: { xs: 2.5, md: 3 }
        }}
      >
        <Stack spacing={2.5}>
          <Stack spacing={0.75}>
            <Typography variant="h6">Perf status</Typography>
            <Typography color="text.secondary" variant="body2">
              Use this route to validate that the first non-home navigation still meets the p75 interaction envelope.
            </Typography>
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="body2">Route readiness</Typography>
            <LinearProgress aria-label="Overview route readiness" value={78} variant="determinate" />
          </Stack>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Metric</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {metrics.map((metric) => (
                <TableRow key={metric.label}>
                  <TableCell>{metric.label}</TableCell>
                  <TableCell>{metric.target}</TableCell>
                  <TableCell>{metric.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </Paper>
    </Stack>
  );
}
