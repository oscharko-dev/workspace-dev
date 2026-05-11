import { preconnect, prefetchDNS } from "react-dom";

const resolveExternalOrigins = ({
  endpoint,
  pageHref
}: {
  endpoint: string | undefined;
  pageHref: string;
}): string[] => {
  const trimmedEndpoint = endpoint?.trim();
  if (!trimmedEndpoint) {
    return [];
  }

  try {
    const endpointUrl = new URL(trimmedEndpoint, pageHref);
    const pageUrl = new URL(pageHref);
    if (endpointUrl.origin === pageUrl.origin) {
      return [];
    }
    return [endpointUrl.origin];
  } catch {
    return [];
  }
};

export const getRuntimeHintOrigins = (): string[] => {
  return resolveExternalOrigins({
    endpoint: import.meta.env.VITE_PERF_ENDPOINT,
    pageHref: window.location.href
  });
};

export const applyRuntimeResourceHints = (): void => {
  for (const origin of getRuntimeHintOrigins()) {
    prefetchDNS(origin);
    preconnect(origin, { crossOrigin: "" });
  }
};
