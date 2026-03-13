Feature: Workspace mode lock contract
  workspace-dev must keep deterministic mode-lock behavior stable.

  Scenario: Accept locked modes
    Given figmaSourceMode is "rest"
    And llmCodegenMode is "deterministic"
    When mode lock validation runs
    Then the mode lock result is valid

  Scenario: Reject unsupported modes with actionable guidance
    Given figmaSourceMode is "mcp"
    And llmCodegenMode is "hybrid"
    When mode lock validation runs
    Then the mode lock result is invalid
    And the mode lock errors mention full Workspace Dev platform deployment
