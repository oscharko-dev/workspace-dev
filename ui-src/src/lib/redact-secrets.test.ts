import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact-secrets";

describe("redactSecrets", () => {
  it("redacts token/access/key fields except figmaFileKey", () => {
    const input = {
      figmaFileKey: "abc123",
      figmaAccessToken: "secret-token",
      nested: {
        repoToken: "ghp_secret",
        apiKey: "api-secret"
      }
    };

    const result = redactSecrets({ value: input }) as Record<string, unknown>;

    expect(result.figmaFileKey).toBe("abc123");
    expect(result.figmaAccessToken).toBe("[REDACTED]");

    const nested = result.nested as Record<string, unknown>;
    expect(nested.repoToken).toBe("[REDACTED]");
    expect(nested.apiKey).toBe("[REDACTED]");
  });
});
