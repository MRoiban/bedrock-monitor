import type { Health } from "../server/model";
const EVENTS: Record<string, { text: string; tone: Health }> = {
  activate: { text: "Activated", tone: "start" }, spawn: { text: "Process started", tone: "start" },
  ready: { text: "Ready", tone: "ok" }, crash: { text: "Crashed", tone: "bad" },
  retry: { text: "Retry scheduled", tone: "warn" }, exit: { text: "Exited", tone: "stop" },
  deploy: { text: "Deployed a release", tone: "start" }, retire: { text: "Retired the previous release", tone: "stop" },
  hibernate: { text: "Hibernated", tone: "idle" }, wake: { text: "Woke on request", tone: "start" },
  idle: { text: "Went idle", tone: "idle" }, stop: { text: "Stopped", tone: "stop" },
};
const LOOP = new Set(["spawn", "crash", "retry", "exit"]);
/** One row per event, except that a crash loop's spawn/crash/retry churn becomes one summary row. */
export function eventRows(rows: { time: number; event?: string }[]) {
  const out: { from: number; to: number; text: string; tone: Health }[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && LOOP.has(rows[j]!.event ?? "")) j++;
    const run = rows.slice(i, j);
    const crashes = run.filter((r) => r.event === "crash").length;
    if (crashes >= 2) {
      const times = run.map((r) => r.time);
      const retries = run.filter((r) => r.event === "retry").length;
      out.push({ from: Math.min(...times), to: Math.max(...times), tone: "bad",
        text: `Crash loop · ${crashes} crashes${retries ? `, ${retries} retries` : ""}` });
      i = j;
      continue;
    }
    const e = rows[i]!, name = e.event ?? "event";
    const known = EVENTS[name];
    out.push({ from: e.time, to: e.time, text: known?.text ?? name.charAt(0).toUpperCase() + name.slice(1), tone: known?.tone ?? "unk" });
    i++;
  }
  return out;
}
