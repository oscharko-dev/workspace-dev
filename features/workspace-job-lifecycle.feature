Feature: Workspace job lifecycle contract
  workspace-dev must keep its public HTTP job lifecycle behavior stable.

  Scenario: Submit a valid job request
    Given the runtime accepts a public submit request
    When the client submits a valid job payload
    Then the runtime responds with a queued job and later reaches a completed terminal state

  Scenario: Reject an invalid submit payload
    Given the runtime exposes the public submit endpoint
    When the client submits an invalid payload
    Then the runtime rejects the request with a validation error

  Scenario: Treat duplicate submit requests as separate jobs
    Given the runtime accepts repeated public submit requests
    When the client submits the same valid payload twice
    Then the runtime accepts both requests as separate jobs with distinct job identifiers

  Scenario: Report queued and running job states
    Given the runtime has both running and queued work
    When the client polls the public job status endpoint
    Then the runtime reports queued and running states without exposing internals

  Scenario: Report completed and failed terminal states
    Given the runtime has terminal jobs
    When the client polls the public job status endpoint
    Then the runtime reports completed and failed terminal states

  Scenario: Cancel queued and running jobs
    Given the runtime has queued and running jobs
    When the client requests cancellation through the public cancel endpoint
    Then the runtime eventually reports canceled terminal states

  Scenario: Return the existing terminal state when canceling a completed job
    Given the runtime already completed a job
    When the client requests cancellation for that completed job
    Then the runtime returns the existing completed terminal state
