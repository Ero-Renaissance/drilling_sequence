/**
 * URL segments are free text — an id, or anything typed into the address bar.
 * The header (and its breadcrumbs) sits outside every error boundary, so a
 * segment named after an Object member ("__proto__", "constructor") must read
 * as an unknown segment, never an inherited value: "__proto__" used to render
 * Object.prototype and blank the whole app.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";

import { Breadcrumbs } from "@/components/layout/Breadcrumbs";

function crumbsAt(path: string): string {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );
  return container.textContent ?? "";
}

describe("Breadcrumbs", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "a campaign id of %s reads as an unknown campaign",
    (id) => {
      expect(crumbsAt(`/projects/${id}/readiness`)).toBe("CampaignsCampaignReadiness");
    },
  );

  it("a revision id of __proto__ reads as a revision", () => {
    expect(crumbsAt("/projects/p1/revisions/__proto__")).toBe("CampaignsCampaignRevisionsRevision");
  });

  it("still labels the known segments", () => {
    expect(crumbsAt("/projects/p1/chart")).toBe("CampaignsCampaignSequence");
  });
});
