Feature: Workspace security contract
  workspace-dev must keep its public write-route and source-serving security behavior stable.

  Scenario: Reject protected write routes from non-loopback bind without same-origin metadata
    Given the runtime binds to a non-loopback host
    When a browser sends protected write requests with cross-site or missing same-origin metadata
    Then the runtime rejects the request with FORBIDDEN_REQUEST_ORIGIN

  Scenario: Reject path traversal attempts on job artifact file-listing and file routes
    Given the runtime completes a local source job
    When a client requests a traversal path from job artifacts
    Then the runtime rejects the request with FORBIDDEN_PATH
