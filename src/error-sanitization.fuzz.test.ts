import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { sanitizeErrorMessage } from "./error-sanitization.js";

const SECRET_SUFFIX_PATTERN = /^[A-Za-z0-9._-]{10,24}$/;

const secretTokenArb = fc
  .tuple(
    fc.constantFrom("ghp_", "figd_", "sk-"),
    fc.stringMatching(SECRET_SUFFIX_PATTERN),
  )
  .map(([prefix, suffix]) => `${prefix}${suffix}`);

const secretFragmentArb = secretTokenArb.chain((secret) =>
  fc.constantFrom(
    { secret, fragment: `repoToken=${secret}` },
    { secret, fragment: `figmaAccessToken=${secret}` },
    { secret, fragment: `authorization: bearer ${secret}` },
    { secret, fragment: `Authorization: Bearer ${secret}` },
    { secret, fragment: `Bearer ${secret}` },
    { secret, fragment: `{"token":"${secret}"}` },
    { secret, fragment: `{"Authorization":"Bearer ${secret}"}` },
  ),
);

const passesLuhnChecksum = (candidate: string): boolean => {
  let checksum = 0;
  let shouldDouble = false;

  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    const digit = candidate.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      return false;
    }

    let contribution = digit;
    if (shouldDouble) {
      contribution *= 2;
      if (contribution > 9) {
        contribution -= 9;
      }
    }

    checksum += contribution;
    shouldDouble = !shouldDouble;
  }

  return checksum % 10 === 0;
};

const toLuhnCandidate = (body: string): string => {
  for (let digit = 0; digit <= 9; digit += 1) {
    const candidate = `${body}${digit}`;
    if (passesLuhnChecksum(candidate)) {
      return candidate;
    }
  }

  throw new Error("Expected a valid Luhn check digit.");
};

const panLikeProfileArb = fc.constantFrom(
  { prefix: "4", lengths: [13, 16, 19] },
  { prefix: "34", lengths: [15] },
  { prefix: "37", lengths: [15] },
  { prefix: "51", lengths: [16] },
  { prefix: "55", lengths: [16] },
  { prefix: "62", lengths: [16, 17, 18, 19] },
  { prefix: "65", lengths: [16, 19] },
  { prefix: "300", lengths: [14] },
  { prefix: "305", lengths: [14] },
  { prefix: "644", lengths: [16, 19] },
  { prefix: "649", lengths: [16, 19] },
  { prefix: "2221", lengths: [16] },
  { prefix: "2720", lengths: [16] },
  { prefix: "3528", lengths: [16, 17, 18, 19] },
  { prefix: "3589", lengths: [16, 17, 18, 19] },
  { prefix: "6011", lengths: [16, 19] },
);

const luhnPanArb = panLikeProfileArb.chain(({ prefix, lengths }) =>
  fc
    .constantFrom(...lengths)
    .chain((totalLength) =>
      fc
        .array(fc.integer({ min: 0, max: 9 }), {
          minLength: totalLength - prefix.length - 1,
          maxLength: totalLength - prefix.length - 1,
        })
        .map((digits) => toLuhnCandidate(`${prefix}${digits.join("")}`)),
    ),
  );

const toSanitizedMessage = ({
  fragment,
  useCause,
}: {
  fragment: string;
  useCause: boolean;
}): string => {
  const cause = useCause ? new Error(`inner leak ${fragment}`) : undefined;
  if (cause) {
    cause.stack = undefined;
  }

  const error = useCause
    ? new Error("outer failure", { cause })
    : new Error(`leak ${fragment}`);
  error.stack = undefined;

  return sanitizeErrorMessage({
    error,
    fallback: "fallback",
  });
};

test("fuzz: sanitizeErrorMessage redacts secret-bearing fragments in root errors and causes", () => {
  fc.assert(
    fc.property(secretFragmentArb, fc.boolean(), ({ fragment, secret }, useCause) => {
      const sanitized = toSanitizedMessage({ fragment, useCause });

      assert.equal(
        sanitized.includes(secret),
        false,
        `Expected secret to be redacted for fragment=${fragment}`,
      );
      assert.match(sanitized, /\[redacted-secret]/);
    }),
    { numRuns: 100 },
  );
});

test("fuzz: sanitizeErrorMessage redacts Luhn-valid PAN-like sequences in root errors and causes", () => {
  fc.assert(
    fc.property(luhnPanArb, fc.boolean(), (pan, useCause) => {
      const sanitized = toSanitizedMessage({
        fragment: `card ${pan}`,
        useCause,
      });

      assert.equal(
        sanitized.includes(pan),
        false,
        `Expected PAN to be redacted for ${pan}`,
      );
      assert.match(sanitized, /\[redacted-pan]/);
    }),
    { numRuns: 100 },
  );
});
