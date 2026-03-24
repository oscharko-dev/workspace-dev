import { Suspense } from "react";
import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Toolbar,
  Typography
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import RouteSkeleton from "./components/RouteSkeleton";
import HomeRoute from "./routes/HomeRoute";
import { LazyCheckoutRoute, LazyOverviewRoute, warmRouteModule, type WarmRouteKey } from "./routes/lazy-routes";

const navItems: ReadonlyArray<{
  description: string;
  label: string;
  route: string;
  warmKey?: WarmRouteKey;
}> = [
  {
    description: "Landing route",
    label: "Home",
    route: "/"
  },
  {
    description: "Lazy overview route",
    label: "Overview",
    route: "/overview",
    warmKey: "overview"
  },
  {
    description: "Lazy checkout route",
    label: "Checkout",
    route: "/checkout",
    warmKey: "checkout"
  }
];

const routeFallback = <RouteSkeleton />;

function TemplateNavigation() {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap>
      {navItems.map((item) => {
        const warmKey = item.warmKey;
        const warmRoute = warmKey === undefined ? undefined : () => warmRouteModule(warmKey);
        return (
          <Button
            key={item.route}
            aria-label={`${item.label} route`}
            color="inherit"
            component={NavLink}
            onFocus={warmRoute}
            onPointerEnter={warmRoute}
            to={item.route}
            sx={{
              borderRadius: 999,
              justifyContent: "flex-start",
              px: 1.75,
              py: 0.875,
              textTransform: "none",
              "&.active": {
                backgroundColor: alpha("#FFFFFF", 0.18)
              }
            }}
          >
            <Stack alignItems="flex-start" spacing={0.125}>
              <Typography component="span" fontWeight={600}>
                {item.label}
              </Typography>
              <Typography component="span" sx={{ opacity: 0.72, typography: "caption" }}>
                {item.description}
              </Typography>
            </Stack>
          </Button>
        );
      })}
    </Stack>
  );
}

function AppShell() {
  return (
    <Box
      sx={{
        background:
          "linear-gradient(180deg, rgba(10,132,255,0.16) 0%, rgba(245,247,251,0.94) 28%, rgba(245,247,251,1) 100%)",
        minHeight: "100vh"
      }}
    >
      <AppBar
        color="transparent"
        elevation={0}
        position="sticky"
        sx={{
          backdropFilter: "blur(18px)",
          backgroundColor: alpha("#0F172A", 0.74),
          borderBottom: "1px solid",
          borderColor: alpha("#FFFFFF", 0.12)
        }}
      >
        <Toolbar sx={{ alignItems: "flex-start", flexDirection: "column", gap: 1.5, py: 2 }}>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} width="100%">
            <Stack spacing={0.75}>
              <Chip
                color="primary"
                label="React 19 performance seed"
                sx={{ alignSelf: "flex-start", fontWeight: 700 }}
                variant="filled"
              />
              <Typography color="#F8FAFC" variant="h5">
                Routed template with real lazy-route and perf-gate coverage
              </Typography>
            </Stack>
            <Typography color="rgba(248,250,252,0.78)" maxWidth={420} variant="body2">
              Secondary routes warm on intent, vitals report from the first paint, and the seed remains small enough
              for realistic budget enforcement.
            </Typography>
          </Stack>
          <TemplateNavigation />
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ pb: 8, pt: { xs: 4, md: 6 } }}>
        <Paper
          elevation={0}
          sx={{
            backgroundColor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 4,
            overflow: "hidden",
            p: { xs: 2.5, md: 3.5 }
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
            <Stack spacing={1}>
              <Typography variant="overline">Template baseline</Typography>
              <Typography variant="h3">Initial load stays lean, route transitions stay measurable.</Typography>
            </Stack>
            <Stack spacing={1}>
              <Typography color="text.secondary" variant="body2">
                The home route is eager, while Overview and Checkout are lazy. Pointer and keyboard intent trigger route
                warmup before navigation.
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Chip label="INP ≤ 200 ms" size="small" />
                <Chip label="LCP ≤ 2500 ms" size="small" />
                <Chip label="Route transition ≤ 300 ms" size="small" />
              </Stack>
            </Stack>
          </Stack>
        </Paper>

        <Box sx={{ mt: 4 }}>
          <Suspense fallback={routeFallback}>
            <Routes>
              <Route
                element={
                  <ErrorBoundary>
                    <HomeRoute />
                  </ErrorBoundary>
                }
                path="/"
              />
              <Route
                element={
                  <ErrorBoundary>
                    <LazyOverviewRoute />
                  </ErrorBoundary>
                }
                path="/overview"
              />
              <Route
                element={
                  <ErrorBoundary>
                    <LazyCheckoutRoute />
                  </ErrorBoundary>
                }
                path="/checkout"
              />
            </Routes>
          </Suspense>
        </Box>
      </Container>
    </Box>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
