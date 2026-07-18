import { beforeEach, describe, expect, it } from "vitest";
import { currentProjectStorageKey, readCurrentProjectId, writeCurrentProjectId } from "./currentProjectStorage";

describe("current project storage", () => {
  beforeEach(() => localStorage.clear());

  it("stores the current project per signed-in user", () => {
    writeCurrentProjectId("github:1", "session-a");
    writeCurrentProjectId("github:2", "session-b");

    expect(currentProjectStorageKey("github:1")).toBe("fgs_current_project:github:1");
    expect(readCurrentProjectId("github:1")).toBe("session-a");
    expect(readCurrentProjectId("github:2")).toBe("session-b");
  });

  it("migrates the legacy global value once a user is known", () => {
    localStorage.setItem("fgs_current_project", "legacy-session");
    expect(readCurrentProjectId("github:1")).toBe("legacy-session");

    writeCurrentProjectId("github:1", "session-a");
    expect(localStorage.getItem("fgs_current_project")).toBeNull();
    expect(readCurrentProjectId("github:1")).toBe("session-a");
  });

  it("does not read anonymous storage before auth resolves", () => {
    localStorage.setItem("fgs_current_project", "legacy-session");
    expect(readCurrentProjectId(null)).toBeNull();
  });
});
