import { describe, expect, it } from "vitest";
import { getInitialFigmaKeyFromPath } from "./path-utils";

describe("getInitialFigmaKeyFromPath", () => {
  it("returns the decoded figma key for direct workspace board routes", () => {
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/board-key" })).toBe("board-key");
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/team%2Ffile%20123" })).toBe("team/file 123");
  });

  it("rejects workspace internal routes and invalid shapes", () => {
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/ui" })).toBeUndefined();
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/jobs/job-1" })).toBeUndefined();
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/repros/job-1" })).toBeUndefined();
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/too/many/segments" })).toBeUndefined();
    expect(getInitialFigmaKeyFromPath({ pathname: "/outside/workspace" })).toBeUndefined();
  });

  it("returns undefined when the route contains invalid percent encoding", () => {
    expect(getInitialFigmaKeyFromPath({ pathname: "/workspace/%E0%A4%A" })).toBeUndefined();
  });
});
