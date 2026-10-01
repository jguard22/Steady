import { describe, it, expect } from "vitest";
import { createDemoApi, resetDemo } from "../src/cloud/demo-api.js";

describe("demo personas", () => {
  it("tells Margaret's story: a sustained change after the new medicine", async () => {
    resetDemo();
    const api = createDemoApi({ viewer: "wearer" });
    const s = await api.summary();
    expect(s.evaluation.status).toBe("review");
    expect(s.evaluation.notes.length).toBeGreaterThan(2);
    expect(s.alerts.some((a) => a.kind === "possibleFall" && a.status === "resolved")).toBe(true);
    expect(s.checks.length).toBeGreaterThan(5);
  });

  it("gives the family view scoped data and the clinic a mixed panel", async () => {
    const fam = createDemoApi({ viewer: "family" });
    const people = await fam.people();
    expect(people.map((p) => p.displayName).sort()).toEqual(["Margaret Ellis", "Walter Ellis"]);
    const walter = people.find((p) => p.displayName === "Walter Ellis");
    expect(walter.status).toBe("steady");
    const ms = await fam.personSummary("demo-margaret");
    expect(ms.days[0].gait).toBeUndefined();
    expect(ms.days[0].minutes).toBeTruthy();

    const clinic = createDemoApi({ viewer: "clinician" });
    const panel = await clinic.people();
    const counts = panel.reduce((a, p) => ((a[p.status] = (a[p.status] ?? 0) + 1), a), {});
    console.log(counts, panel.map((p) => `${p.displayName}:${p.status}:${p.urgent}`).join(" | "));
    expect(panel.length).toBe(12);
    expect(counts.review).toBeGreaterThanOrEqual(2);
    expect(counts.steady).toBeGreaterThanOrEqual(3);
    expect(counts.learning).toBe(1);
    expect(counts.nodata).toBe(1);
  });
});
