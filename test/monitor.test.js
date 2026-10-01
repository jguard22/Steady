import { describe, it, expect } from "vitest";
import { createMonitor } from "../src/engine/monitor.js";
import { generate, feed } from "../src/sense/simulator.js";

function run(script, opts = {}) {
  const events = [];
  const m = createMonitor({ refLoad: opts.refLoad ?? 1000, onEvent: (type, data) => events.push({ type, data }), tzOffsetMin: 0 });
  const frames = generate(script, { seed: opts.seed ?? 3, wearer: opts.wearer });
  feed(m, frames);
  return { m, events, day: m.flush(frames.end + 6000) };
}

describe("monitor: walking", () => {
  it("measures cadence, variability and steps for a steady walk", () => {
    const { day } = run([{ kind: "stand", s: 4 }, { kind: "walk", s: 40, cadence: 104, strideCv: 2 }, { kind: "stand", s: 4 }]);
    expect(day.gait).toBeTruthy();
    expect(day.gait.cadenceSpm).toBeGreaterThan(98);
    expect(day.gait.cadenceSpm).toBeLessThan(110);
    expect(day.gait.strideTimeCvPct).toBeLessThan(5);
    expect(day.steps).toBeGreaterThan(55);
    expect(day.minutes.walk).toBeGreaterThan(0.5);
    expect(day.gait.doubleSupportPct).toBeGreaterThan(10);
    expect(day.gait.doubleSupportPct).toBeLessThan(40);
  });

  it("sees higher variability and asymmetry when the walk is less regular", () => {
    const steady = run([{ kind: "walk", s: 40, strideCv: 1.5 }]).day.gait;
    const shaky = run([{ kind: "walk", s: 40, strideCv: 7, asymmetry: 0.12 }]).day.gait;
    expect(shaky.strideTimeCvPct).toBeGreaterThan(steady.strideTimeCvPct * 1.8);
    expect(shaky.stanceAsymPct).toBeGreaterThan(steady.stanceAsymPct + 5);
  });

  it("estimates stride length from the swing (ZUPT)", () => {
    const { day } = run([{ kind: "walk", s: 30, strideLengthM: 1.2 }]);
    expect(day.gait.strideLengthM).toBeGreaterThan(1.0);
    expect(day.gait.strideLengthM).toBeLessThan(1.4);
    expect(day.gait.gaitSpeedMps).toBeGreaterThan(0.8);
  });

  it("ignores walks shorter than five seconds for gait measures", () => {
    const { day } = run([{ kind: "stand", s: 3 }, { kind: "walk", s: 3.5 }, { kind: "stand", s: 3 }]);
    expect(day.gait).toBeNull();
  });

  it("flags an unsteady moment (long step + catch step)", () => {
    const { day, events } = run([{ kind: "walk", s: 30, strideCv: 1.5, stumbleAt: 15 }]);
    expect(day.events.unsteady).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === "unsteady")).toBe(true);
  });

  it("marks heel strikes as the point of contact", () => {
    const { day } = run([{ kind: "walk", s: 30 }]);
    expect(day.gait.strikePct.heel).toBeGreaterThan(60);
  });
});

describe("monitor: standing, sitting, rising", () => {
  it("classifies sitting and standing time", () => {
    const { day } = run([{ kind: "sit", s: 60 }, { kind: "rise", s: 3 }, { kind: "stand", s: 40 }]);
    expect(day.minutes.sit).toBeGreaterThan(0.9);
    expect(day.minutes.stand).toBeGreaterThan(0.5);
  });

  it("measures quiet-standing sway and it grows with a wobblier stance", () => {
    const calm = run([{ kind: "stand", s: 25, swayMm: 4 }]).day.balance;
    const wobbly = run([{ kind: "stand", s: 25, swayMm: 14 }]).day.balance;
    expect(calm.windows).toBeGreaterThanOrEqual(1);
    expect(wobbly.swayRmsMm).toBeGreaterThan(calm.swayRmsMm * 2);
    expect(calm.weightLeftPct).toBeGreaterThan(40);
    expect(calm.weightLeftPct).toBeLessThan(60);
  });

  it("times a sit-to-stand and the pause before walking", () => {
    const { day, events } = run([
      { kind: "sit", s: 5 }, { kind: "rise", s: 4, riseS: 1.6 }, { kind: "walk", s: 12 },
    ]);
    expect(day.transitions.sitToStand).toBe(1);
    expect(day.transitions.riseTimeS).toBeGreaterThan(0.6);
    expect(day.transitions.riseTimeS).toBeLessThan(2.5);
    expect(day.transitions.riseToWalkPauseS).toBeGreaterThan(1);
    expect(events.some((e) => e.type === "stood")).toBe(true);
  });

  it("notices a raised leg while seated", () => {
    const { day } = run([{ kind: "sit", s: 30, raised: "left" }]);
    expect(day.minutes.sitLeftRaised).toBeGreaterThan(0.3);
  });
});

describe("monitor: possible fall", () => {
  it("reports a possible fall after an abrupt loss of load from standing", () => {
    const { events, day } = run([{ kind: "stand", s: 5 }, { kind: "fall", s: 20 }]);
    const f = events.find((e) => e.type === "possibleFall");
    expect(f).toBeTruthy();
    expect(f.data.confidence).toBe("higher");
    expect(day.events.possibleFalls).toBe(1);
  });

  it("does not report sitting down as a fall", () => {
    const { events } = run([{ kind: "stand", s: 5 }, { kind: "sitDown", s: 3 }, { kind: "sit", s: 30 }]);
    expect(events.some((e) => e.type === "possibleFall")).toBe(false);
  });
});

describe("monitor: reference load", () => {
  it("learns body load from walking when nothing is saved", () => {
    const events = [];
    const m = createMonitor({ onEvent: (type, data) => events.push({ type, data }), tzOffsetMin: 0 });
    const frames = generate([{ kind: "walk", s: 30 }, { kind: "stand", s: 20 }], { seed: 9 });
    feed(m, frames);
    m.flush(frames.end + 6000);
    expect(m.W).toBeGreaterThan(800);
    expect(m.W).toBeLessThan(1250);
  });

  it("calibrates from a weigh-in", () => {
    const events = [];
    const m = createMonitor({ onEvent: (type, data) => events.push({ type, data }), tzOffsetMin: 0 });
    const frames = generate([{ kind: "stand", s: 6, swayMm: 3 }], { seed: 2 });
    m.startWeighIn(frames.pressure[0].t);
    feed(m, frames);
    const w = events.find((e) => e.type === "weighIn");
    expect(w.data.ok).toBe(true);
    expect(m.W).toBeGreaterThan(900);
    expect(m.W).toBeLessThan(1100);
  });
});
