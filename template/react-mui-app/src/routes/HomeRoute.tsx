import { Chip, Divider, Grid, Paper, Stack, Typography } from "@mui/material";

const vitals = [
  {
    body: "Input latency stays inside a sub-200 ms interaction budget.",
    title: "INP p75 ≤ 200 ms"
  },
  {
    body: "Largest route content paints inside the standard fast-load threshold.",
    title: "LCP p75 ≤ 2500 ms"
  },
  {
    body: "Layout remains stable while lazy routes and MUI surfaces stream in.",
    title: "CLS p75 ≤ 0.10"
  }
] as const;

export default function HomeRoute() {
  return (
    <Stack component="main" id="main-content" spacing={3}>
      <Stack spacing={1.5}>
        <Chip color="secondary" label="Home route is eagerly bundled" sx={{ alignSelf: "flex-start" }} />
        <Typography variant="h4">Performance-first seed app</Typography>
        <Typography color="text.secondary" maxWidth={720} variant="body1">
          This starter keeps the first route hot while still exercising lazy route splits, route warmup on intent, web
          vitals reporting, and root-level error callbacks.
        </Typography>
      </Stack>

      <Grid container spacing={2}>
        {vitals.map((metric) => (
          <Grid key={metric.title} size={{ xs: 12, md: 4 }}>
            <Paper
              elevation={0}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 4,
                height: "100%",
                p: 2.5
              }}
            >
              <Stack spacing={1.25}>
                <Typography variant="h6">{metric.title}</Typography>
                <Typography color="text.secondary" variant="body2">
                  {metric.body}
                </Typography>
              </Stack>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 4,
          p: { xs: 2.5, md: 3 }
        }}
      >
        <Stack divider={<Divider flexItem />} spacing={2.5}>
          <Stack spacing={0.75}>
            <Typography variant="h6">Why this route stays eager</Typography>
            <Typography color="text.secondary" variant="body2">
              Home is the first paint route, so its content should not wait behind a lazy boundary. That keeps the
              initial JavaScript budget meaningful and makes secondary-route code splitting measurable instead of
              theoretical.
            </Typography>
          </Stack>
          <Stack spacing={0.75}>
            <Typography variant="h6">How secondary routes get faster</Typography>
            <Typography color="text.secondary" variant="body2">
              The navigation warms Overview and Checkout chunks on pointer and keyboard intent, reducing the gap between
              first interaction and rendered route content.
            </Typography>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
