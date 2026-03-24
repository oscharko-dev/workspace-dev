import { Box, Paper, Skeleton, Stack } from "@mui/material";

export default function RouteSkeleton() {
  return (
    <Box
      aria-busy="true"
      aria-label="Loading route content"
      component="section"
      role="status"
      sx={{ py: { xs: 2, md: 4 } }}
    >
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
          <Skeleton height={34} variant="text" width="42%" />
          <Skeleton height={24} variant="text" width="74%" />
          <Skeleton height={120} variant="rounded" />
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Skeleton height={96} sx={{ flex: 1 }} variant="rounded" />
            <Skeleton height={96} sx={{ flex: 1 }} variant="rounded" />
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
