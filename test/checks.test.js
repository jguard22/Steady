import { describe, it, expect } from "vitest";
import { walkTest, balanceTest, chairStandTest, tugTest, summarizeCheck, chairReference } from "../src/engine/checks.js";
import { generate } from "../src/sense/simulator.js";

function runCheck(test, script, { seed = 4, tickMs = 100, extraMs = 4000 } = {}) {
  const fr = generate(script, { seed, motion: false });
  const t0 = fr.pressure[0].t;
  test.start(t0);
  let nextTick = t0;
  for (const f of fr.pressure) {
    test.pressure(f);
    if (f.t >= nextTick) { test.tick(f.t); nextTick = f.t + tickMs; }
    if (test.result) break;
  }
  for (let t = fr.end; t < fr.end + extraMs && !test.result; t += tickMs) test.tick(t);
  return test.result;
}

describe("Steady Check", () => {
  it("times a 4 m walk", () => {
    const r = runCheck(walkTest({ W: 1000, courseM: 4 }), [
      { kind: "stand", s: 1 }, { kind: "walk", s: 4.2, cadence: 100 }, { kind: "stand", s: 3 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.durationS).toBeGreaterThan(3);
    expect(r.durationS).toBeLessThan(4.6);
    expect(r.speedMps).toBeGreaterThan(0.85);
    expect(r.steps).toBeGreaterThanOrEqual(5);
  });

  it("runs the four balance stances and stops at the first one not held", () => {
    const r = runCheck(balanceTest({ W: 1000 }), [
      { kind: "stand", s: 10.3, swayMm: 3 },
      { kind: "stand", s: 10.3, swayMm: 5 },
      { kind: "stand", s: 6, swayMm: 9 },
      { kind: "oneLeg", s: 3, side: "left" }, // foot comes up in tandem = stop
    ]);
    expect(r.ok).toBe(true);
    expect(r.stages.length).toBe(3);
    expect(r.completed).toBe(2);
    expect(r.stoppedAt).toBe("tandem");
  });

  it("counts chair stands over 30 s", () => {
    const script = [{ kind: "sit", s: 0.5 }];
    for (let i = 0; i < 10; i++) script.push({ kind: "rise", s: 1.6, riseS: 1.0 }, { kind: "sitDown", s: 1.2 });
    script.push({ kind: "sit", s: 6 });
    const r = runCheck(chairStandTest({ W: 1000 }), script, { extraMs: 32000 });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(10);
  });

  it("times Timed Up & Go", () => {
    const r = runCheck(tugTest({ W: 1000 }), [
      { kind: "sit", s: 1 }, { kind: "rise", s: 1.5, riseS: 1.2 }, { kind: "walk", s: 7 }, { kind: "sitDown", s: 1.2 }, { kind: "sit", s: 3 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.totalS).toBeGreaterThan(8);
    expect(r.totalS).toBeLessThan(12);
  });

  it("scores a sitting and lists clinician references", () => {
    const s = summarizeCheck({
      walk: { ok: true, speedMps: 0.9 },
      talkWalk: { ok: true, speedMps: 0.7 },
      balance: { ok: true, completed: 2, stages: [{ stage: "together", holdS: 10 }, { stage: "semiTandem", holdS: 10 }, { stage: "tandem", holdS: 6, swayRmsMm: 12 }] },
      chair: { ok: true, count: 8 },
      tug: { ok: true, totalS: 13.1 },
    }, { age: 78, sex: "female" });
    expect(s.score).toBeGreaterThan(30);
    expect(s.score).toBeLessThan(80);
    expect(s.references.find((r) => r.key === "tug").met).toBe(true);
    expect(s.references.find((r) => r.key === "chair").met).toBe(true);
    expect(s.dualTaskCostPct).toBe(22);
    expect(chairReference(78, "male")).toBe(11);
  });
});
