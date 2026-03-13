export interface JsonResponse<TPayload> {
  status: number;
  ok: boolean;
  payload: TPayload | Record<string, unknown>;
}

const EMPTY_OBJECT = {} as const;

const parsePayload = ({ text }: { text: string }): Record<string, unknown> => {
  if (!text.trim()) {
    return { ...EMPTY_OBJECT };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { raw: text };
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
};

export async function fetchJson<TPayload>({
  url,
  init
}: {
  url: string;
  init?: RequestInit;
}): Promise<JsonResponse<TPayload>> {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  const payload = parsePayload({ text: bodyText });

  return {
    status: response.status,
    ok: response.ok,
    payload: payload as TPayload | Record<string, unknown>
  };
}
