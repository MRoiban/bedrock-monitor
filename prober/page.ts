import { join } from "node:path";
import { STALE, activeIncident, day, type Daily, type State } from "./model";
import { expected, readDaily, readState } from "./journal";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export const clock = (text: string) => text.slice(11, 16);
const icons = {
  ok: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.6 8.2l2.2 2.2 4.6-4.8" stroke="var(--app)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  bad: '<path d="M5.1 1h5.8L15 5.1v5.8L10.9 15H5.1L1 10.9V5.1z" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="var(--app)" stroke-width="1.8" stroke-linecap="round"/>',
  unk: '<circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.6 2"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1M8 11.2v.3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  warn: '<path d="M8 1.5L15 14H1z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 6v3M8 11v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};
export const icon = (tone: keyof typeof icons) => `<svg width="26" height="26" viewBox="0 0 16 16" aria-hidden="true">${icons[tone]}</svg>`;
export function snapshot(state: State, publishedAt: string) {
  // Construct an allowlisted public projection; never spread operational data into page assets.
  const latest = state.latest;
  const incident = activeIncident(state);
  return {
    version: 1, published_at: publishedAt, stale_after_ms: STALE,
    latest: latest ? { observed_at: latest.observed_at, ok: latest.ok } : null,
    incident: incident ? { opened_at: incident.opened_at } : null,
    last_success_at: state.last_success_at,
  };
}
function history(rows: Daily[], now: number, count: number) {
  const map = new Map(rows.map((row) => [row.date, row]));
  const days: Daily[] = [];
  const midnight = Date.parse(day(now));
  for (let i = count - 1; i >= 0; i--) {
    const date = day(midnight - i * 86_400_000);
    const row = map.get(date);
    days.push({ date, expected: expected(date, now), observed: row?.observed ?? 0, passed: row?.passed ?? 0 });
  }
  const observed = days.reduce((sum, d) => sum + d.observed, 0);
  const passed = days.reduce((sum, d) => sum + d.passed, 0);
  const total = days.reduce((sum, d) => sum + d.expected, 0);
  const percent = (a: number, b: number) => b ? `${(100 * a / b).toFixed(1)} %` : "—";
  const stats = `Probe success ${percent(passed, observed)} · coverage ${total ? percent(observed, total) : "0 %"}`;
  return `<section class="history history-${count}" aria-label="Last ${count} days">
    <h2 class="section-title">Last ${count} days <span class="grow"></span><span class="stats num">${stats}</span></h2>
    <div class="days" role="img" aria-label="${count} daily external check results. ${observed} observed of ${total} expected; ${passed} passed.">${days.map((d) => {
      const tone = !d.observed ? "none" : d.passed < d.observed ? "bad" : d.observed < d.expected ? "unk" : "ok";
      return `<i class="day ${tone}" title="${d.date}: ${d.passed}/${d.observed} passed; ${d.observed}/${d.expected} observed"></i>`;
    }).join("")}</div><div class="daylabels"><span>${count} days ago</span><span>Today</span></div>
    <div class="legend"><span><i class="ok"></i>All checks passed</span><span><i class="bad"></i>Contains a failed check</span><span><i class="unk"></i>Missing evidence</span><span><i class="none"></i>No data</span><span>· 1 day per bar · height shows state, not latency</span></div>
    <details><summary>Daily counts and coverage</summary><table><caption>UTC days · success is passed / observed; coverage is observed / expected</caption><thead><tr><th>Date</th><th>Passed</th><th>Observed</th><th>Expected</th></tr></thead><tbody>${days.map((d) => `<tr><td>${d.date}</td><td>${d.passed}</td><td>${d.observed}</td><td>${d.expected}</td></tr>`).join("")}</tbody></table></details>
  </section>`;
}
export function render(state: State, rows: Daily[], now: number) {
  const publishedAt = new Date(now).toISOString();
  const data = snapshot(state, publishedAt);
  const latest = data.latest;
  const dated = latest ? `Last observation at ${latest.observed_at.replace("T", " ").replace(".000Z", " UTC")}: ${latest.ok ? "reachable" : "failed"}` : "Waiting for the first external observation";
  const open = activeIncident(state);
  const resolved = state.incidents.filter((i) => i.resolved_at).slice(-10).reverse();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Home cloud status</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head>
<body><main class="public">
<header class="head"><div class="brand"><span class="brand-mark" aria-hidden="true">b</span>Home cloud status</div><span class="desc num" title="${publishedAt}">Page published ${clock(publishedAt)} UTC</span></header>
<section class="status" data-tone="unk" aria-labelledby="verdict"><h1 id="verdict" aria-live="polite"><span class="st unk" id="status-icon">${icon("unk")}</span><span id="headline">${escape(dated)}</span></h1>
<p class="num" id="observation">${latest ? "This is a dated snapshot. Current status requires a recent observation and a correct device clock." : "No checks have run yet"}</p>
${open ? `<p id="incident-note"><b>Update ${clock(open.opened_at)} UTC</b> — External checks confirmed the home cloud is unreachable. <span id="recovery-note">Last known incident remains unresolved.</span></p>` : ""}
<div class="scope">External check of the home gateway and daemon, normally every 5 minutes. Individual apps are private and are not tested here.</div></section>
${history(rows, now, 30)}${history(rows, now, 90)}
<section><h2 class="section-title">Past incidents</h2>${resolved.length ? resolved.map((i) => `<div class="update"><b>Unreachable for ${Math.max(1, Math.round((Date.parse(i.resolved_at!) - Date.parse(i.opened_at)) / 60_000))} min</b><div class="desc num">${escape(i.opened_at.replace("T", " ").slice(0, 16))}–${clock(i.resolved_at!)} UTC · resolved</div></div>`).join("") : '<p class="desc">No incidents recorded.</p>'}</section>
<footer class="desc">Independent external observations · UTC times · <a href="https://github.com/TwiN/gatus">Gatus</a>-derived monitoring · Apache-2.0</footer>
<script type="application/json" id="snapshot">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<template id="icon-ok">${icon("ok")}</template><template id="icon-bad">${icon("bad")}</template><template id="icon-warn">${icon("warn")}</template>
</main></body></html>\n`;
}
export async function build(root: string, output: string, now = Date.now()) {
  await Bun.write(join(output, "index.html"), render(await readState(root), await readDaily(root), now));
  for (const file of ["site.css", "site.js"]) await Bun.write(join(output, file), Bun.file(new URL(`../public/${file}`, import.meta.url)));
}
