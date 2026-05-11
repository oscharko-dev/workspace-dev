import { lazy, type ComponentType } from "react";

export type WarmRouteKey = "overview" | "checkout";

type RouteModule = { default: ComponentType };

export const routeModuleLoaders: Record<WarmRouteKey, () => Promise<RouteModule>> = {
  overview: async () => await import("./OverviewRoute"),
  checkout: async () => await import("./CheckoutRoute")
};

const warmedRoutes = new Set<WarmRouteKey>();

const loadRouteModule = async (routeKey: WarmRouteKey): Promise<RouteModule> => {
  return await routeModuleLoaders[routeKey]();
};

export const resetRouteWarmupStateForTests = (): void => {
  warmedRoutes.clear();
};

export const warmRouteModule = (routeKey: WarmRouteKey): void => {
  if (warmedRoutes.has(routeKey)) {
    return;
  }

  warmedRoutes.add(routeKey);
  void loadRouteModule(routeKey);
};

export const LazyOverviewRoute = lazy(async () => await loadRouteModule("overview"));
export const LazyCheckoutRoute = lazy(async () => await loadRouteModule("checkout"));
