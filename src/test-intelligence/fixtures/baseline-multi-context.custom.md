# Open Account — Customer-Provided Business Notes

## Why this archetype exists

Account opening combines a Figma design (the screens and fields), a Jira
ticket (the regulatory framing and reviewer flow), and customer-supplied
markdown (additional business rules that never made it into the design or
the ticket).

## Business rules that must be honoured

- Tax ID is mandatory for every adult customer and must satisfy the
  national checksum specification.
- Postcode must be German-format (5 digits) for the pilot rollout. Other
  formats are out of scope for this baseline archetype.
- The Review screen is the last point at which the customer can correct
  the Tax ID. A new attempt restarts from the Open Account screen.

## Reviewer expectations

A reviewer is expected to confirm the Tax-ID checksum decision before
the case can move to the next stage. Empty Tax-ID values must be
rejected at the Open Account screen rather than at Review.
