// Real-time simulated insoles for the demo: replays the simulator's frames
// against the wall clock, looping through a short "everyday" routine.
import { generate } from "./simulator.js";

export const ROUTINE = [
  { kind: "stand", s: 8, swayMm: 6 },
  { kind: "walk", s: 22, cadence: 100, strideCv: 2.6 },
  { kind: "stand", s: 12, swayMm: 7 },
  { kind: "sitDown", s: 2 },
  { kind: "sit", s: 10 },
  { kind: "rise", s: 3, riseS: 1.6 },
  { kind: "stand", s: 4 },
  { kind: "walk", s: 16, cadence: 98, strideCv: 3.4 },
  { kind: "stand", s: 10, swayMm: 8 },
];

/**
 * @param {{onPressure:Function,onMotion:Function,script?:object[],seed?:number}} h
 * @returns {{stop:()=>void, setScript:(s:object[])=>void}}
 */
export function startLiveSim(h) {
  let script = h.script ?? ROUTINE;
  let seed = h.seed ?? 5;
  let frames = null, i = 0, j = 0;
  function cycle() {
    frames = generate(script, { seed: seed++, t0: Date.now() + 50 });
    i = 0; j = 0;
  }
  cycle();
  const timer = setInterval(() => {
    const now = Date.now();
    while (i < frames.pressure.length && frames.pressure[i].t <= now) h.onPressure(sensorsFor(frames.pressure[i++]));
    while (j < frames.motion.length && frames.motion[j].t <= now) h.onMotion(frames.motion[j++]);
    if (now >= frames.end) cycle();
  }, 40);
  return {
    stop: () => clearInterval(timer),
    setScript(s) { script = s; cycle(); },
  };
}

// Eight sensor dots for the live foot map, loaded around the CoP.
const POS = [[0.35, 0.08], [0.65, 0.1], [0.3, 0.38], [0.62, 0.42], [0.25, 0.66], [0.55, 0.7], [0.8, 0.72], [0.45, 0.92]];
function sensorsFor(f) {
  const y = f.cop?.y ?? 0.5;
  const sensors = POS.map(([x, py]) => ({ x, y: py, v: Math.max(0, Math.min(1, (f.load / 1100) * Math.exp(-((py - y) ** 2) / 0.04))) }));
  return { ...f, sensors };
}
