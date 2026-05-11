Feature: Workspace advanced flow contract
  workspace-dev must keep its public regeneration, sync, and 429 behaviors stable.

  Scenario: Regenerate from a completed source job with lineage
    Given the runtime completed a public source job
    When the client requests regeneration with overrides
    Then the runtime accepts the regeneration request and reports lineage for the completed regeneration job

  Scenario: Return a sync dry-run plan with a confirmation token
    Given the runtime completed a regeneration job
    When the client requests a sync dry-run
    Then the runtime returns a file plan and a confirmation token

  Scenario: Require approval and single-use confirmation tokens for sync apply
    Given the runtime completed a regeneration job with governed source history
    When the client applies sync output through the public sync endpoint
    Then the runtime requires approval first and rejects replayed confirmation tokens

  Scenario: Return queue backpressure when capacity is exhausted
    Given the runtime queue is at capacity
    When the client submits another public job request
    Then the runtime returns queue backpressure with a 429 response

  Scenario: Return rate limiting with Retry-After
    Given the runtime rate limit is exhausted
    When the client submits another public job request
    Then the runtime returns rate limiting with Retry-After
