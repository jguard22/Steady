import { html, nothing } from "../../../vendor/lit.js";
import { state } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { action, fmtDate } from "../../ui/components.js";
import { mySummary } from "./today.js";
import { EXERCISES } from "./exercise.js";
import { addDays } from "../../engine/baseline.js";

export function moveView() {
  const s = mySummary();
  const profile = s.data?.profile;
  const program = profile?.program?.exercises ?? [];
  const checks = s.data?.checks ?? [];
  const practice = (s.data?.events ?? []).filter((e) => e.kind === "practice");
  const today = state.api.today();
  const weekDays = new Set(practice.filter((e) => e.at.slice(0, 10) > addDays(today, -7)).map((e) => e.at.slice(0, 10)));
  const chosen = EXERCISES.filter((e) => program.includes(e.id));
  const others = EXERCISES.filter((e) => !program.includes(e.id));
  return html`
    <h1>Move</h1>
    <p class="ink-2">A little practice most days keeps balance strong. Your insoles count and coach as you go.</p>

    ${action({ ic: "checkCircle", title: "Steady Check", sub: checks[0] ? `Last done ${fmtDate(checks[0].takenAt.slice(0, 10), { weekday: "long" })} · score ${checks[0].score}` : "Five short tests · about 6 minutes", href: "#/check" })}

    <section class="card row">
      <div class="grow"><h3>This week</h3><div class="small muted">Days you practised</div></div>
      <div class="row" style="gap:6px" aria-label=${`${weekDays.size} of 7 days`}>
        ${Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => html`<span title=${d} style="width:14px;height:14px;border-radius:50%;background:${weekDays.has(d) ? "var(--brand)" : "var(--surface-3)"}"></span>`)}
      </div>
    </section>

    ${chosen.length ? html`<h2 class="section-title">Chosen for you${profile?.program?.by ? ` by ${profile.program.by}` : ""}</h2>
      <div class="stack-sm">${chosen.map(card)}</div>` : nothing}
    <h2 class="section-title">${chosen.length ? "More to try" : "Exercises"}</h2>
    <div class="stack-sm">${others.map(card)}</div>
    <p class="footnote">Have a sturdy chair or counter within reach. Stop if you feel dizzy or unwell. Check with your clinician before starting new exercises.</p>
  `;
}

function card(e) {
  return action({ ic: e.icon, title: e.title, sub: `${e.minutes} min · ${e.blurb}`, href: `#/exercise/${e.id}` });
}
