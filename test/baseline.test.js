import { describe, it, expect } from "vitest";
import { evaluate, evaluateMetric, BY_KEY, addDays } from "../src/engine/baseline.js";

function day(date, over = {}) {
  return {
    date,
    minutes: { worn: 600, walk: 45 + (over.walkDelta ?? 0) },
    steps: 4200,
    gait: { cadenceSpm: over.cadence ?? 104, strideTimeCvPct: over.cv ?? 2.2, doubleSupportPct: 24, stepAsymPct: 3, gaitSpeedMps: 1.05, strideLengthM: 1.2 },
    balance: { swayRmsMm: over.sway ?? 6 },
    transitions: { riseTimeS: 1.4 },
    events: { unsteady: over.unsteady ?? 0 },
  };
}
function series(n, start = "2026-07-01", f = () => ({})) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(day(addDays(start, i), f(i)));
  return out;
}
const jitter = (i) => ((i * 7919) % 11) / 10 - 0.5;

describe("baselines", () => {
  it("is still learning with under a week of history", () => {
    const days = series(6);
    expect(evaluate(days, "2026-07-06").status).toBe("learning");
  });

  it("stays steady when nothing changes", () => {
    const days = series(40, "2026-07-01", (i) => ({ cadence: 104 + jitter(i) * 2, cv: 2.2 + jitter(i) * 0.3 }));
    const e = evaluate(days, "2026-08-09");
    expect(e.status).toBe("steady");
  });

  it("ignores one odd day", () => {
    const days = series(40, "2026-07-01", (i) => ({ cadence: i === 38 ? 90 : 104 + jitter(i) }));
    const e = evaluate(days, "2026-08-09");
    expect(e.metrics.find((m) => m.key === "cadence").level).toBe("ok");
  });

  it("calls out a sustained slowdown and less even steps", () => {
    const days = series(45, "2026-07-01", (i) => (i >= 39 ? { cadence: 94, cv: 4.6, walkDelta: -20 } : { cadence: 104 + jitter(i), cv: 2.2 + jitter(i) * 0.2 }));
    const e = evaluate(days, "2026-08-14");
    const cad = e.metrics.find((m) => m.key === "cadence");
    expect(["watch", "review"]).toContain(cad.level);
    expect(e.status).toBe("review");
    expect(e.notes[0].text).toMatch(/usual/);
    expect(e.notes.some((n) => n.key === "strideCv")).toBe(true);
  });

  it("treats unsteady moments as counts", () => {
    const days = series(40, "2026-07-01", (i) => ({ unsteady: i >= 35 ? 2 : i % 9 === 0 ? 1 : 0 }));
    const m = evaluateMetric(days, BY_KEY.unsteady, "2026-08-09");
    expect(m.level).toBe("review");
  });

  it("reports no recent data", () => {
    const days = series(30, "2026-07-01");
    const e = evaluate(days, "2026-08-20");
    expect(e.status).toBe("nodata");
  });
});
