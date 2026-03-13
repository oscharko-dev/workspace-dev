export function getInitialFigmaKeyFromPath({ pathname }: { pathname: string }): string | undefined {
  if (!pathname.startsWith("/workspace/")) {
    return undefined;
  }

  if (pathname.startsWith("/workspace/ui") || pathname.startsWith("/workspace/jobs") || pathname.startsWith("/workspace/repros")) {
    return undefined;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return undefined;
  }

  try {
    return decodeURIComponent(segments[1] ?? "");
  } catch {
    return undefined;
  }
}
