import type { MonitorView } from "../server/model";
/** Past acceptance is evidence about the past: stale data is unknown, and failures outrank old successes. */
export function deliveryState(
  s: MonitorView["snapshot"],
  old: boolean,
  open: MonitorView["incidents"],
): { state: "ok" | "warn" | "bad" | "unk"; text: string } {
  if (!s?.alerts) return { state: "unk", text: "Unavailable" };
  const outbox = s.alerts.outbox;
  if (old)
    return { state: "unk", text: `Unknown · last known ${outbox.some((o) => o.state === "accepted") ? "webhook acceptance" : "state"} observed ${new Date(s.observedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` };
  if (open.some((i) => i.rule === "alert-delivery")) return { state: "bad", text: "Delivery failing · alerts are waiting" };
  const waiting = outbox.filter((o) => o.state === "failed" || (o.state === "pending" && (o.attempts ?? 0) > 0)).length;
  if (waiting) return { state: "warn", text: `${waiting} message${waiting === 1 ? "" : "s"} not yet accepted` };
  return outbox.some((o) => o.state === "accepted")
    ? { state: "ok", text: "Webhook accepted · not proof of phone delivery" }
    : { state: "warn", text: "No webhook acceptance observed" };
}
