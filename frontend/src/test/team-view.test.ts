/**
 * A team grid's Projects | Wells view (spec §8.8): the Readiness tab's query on a
 * lens change, and the per-browser memory of each team's view.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEAM_VIEW_KEY, lensChangeParams, storedTeamView } from "@/components/readiness/team-view";

afterEach(() => vi.restoreAllMocks());

describe("lensChangeParams", () => {
  it("keeps the window but drops the old team's view and project narrowing", () => {
    const prev = new URLSearchParams("lens=logistics&view=wells&project=Bonga&horizon=6");
    expect(lensChangeParams(prev, "wells").toString()).toBe("lens=wells&horizon=6");
  });

  it("sets the view a caller asks for (the All grid's Open: the Wells view)", () => {
    const prev = new URLSearchParams("lens=all&horizon=12");
    expect(lensChangeParams(prev, "logistics", "wells").toString()).toBe("lens=logistics&horizon=12&view=wells");
  });

  it("never touches the query it was given", () => {
    const prev = new URLSearchParams("lens=logistics&view=wells");
    lensChangeParams(prev, "projects");
    expect(prev.toString()).toBe("lens=logistics&view=wells");
  });
});

describe("storedTeamView", () => {
  it("reads each team's own remembered view, and only a valid one", () => {
    window.localStorage.setItem(TEAM_VIEW_KEY, JSON.stringify({ logistics: "wells", wells: "projects", x: "bogus" }));
    expect(storedTeamView("logistics")).toBe("wells");
    expect(storedTeamView("wells")).toBe("projects");
    expect(storedTeamView("x")).toBeNull();
    // A team code named after an Object member is an ordinary team.
    expect(storedTeamView("constructor")).toBeNull();
  });

  it("falls back to nothing on junk or unavailable storage", () => {
    window.localStorage.setItem(TEAM_VIEW_KEY, "{not json");
    expect(storedTeamView("logistics")).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(storedTeamView("logistics")).toBeNull();
  });
});
