// Gatus-inspired separation of observations, hourly summaries and incident episodes.
export type Health = "ok" | "warn" | "bad" | "unk" | "start" | "idle" | "stop";
export interface Quantile {
  lower: number;
  upper: number | null;
  count: number;
  unit: string;
}
export interface Pebble {
  name: string;
  status: string;
  readiness?: { state: string; observed_at: number | null };
  next_retry_at?: number | null;
  backup?: { last_success_at: number | null; interval_ms: number | null } | null;
  memory?: {
    resident: number | null;
    swapped: number | null;
    hibernated_at: number | null;
  };
  telemetry?: {
    last_5m?: {
      ordinary?: {
        starts: number;
        completions: number;
        failures: number;
        p95?: { headers_success: Quantile | null };
      };
    };
    lifecycle?: { time: number; event: string };
    unavailable?: boolean;
  };
}
export interface Incident {
  id: string;
  fingerprint: string;
  pebble: string;
  rule: string;
  job: string;
  opened: number;
  resolved: number | null;
  notified: number | null;
}
export interface Outbox {
  id: string;
  incident: string | null;
  transition: string;
  created: number;
  due: number;
  attempts: number;
  state: string;
  error: string | null;
}
export interface Alerts {
  incidents: Incident[];
  silences: { fingerprint: string; until: number }[];
  outbox: Outbox[];
  checks: { fingerprint: string; state: string; observed: number }[];
  pending?: { count: number };
}
export interface Issue {
  id: string;
  message?: string;
  title?: string;
  type?: string;
  runtime?: string;
  state?: string;
  count?: number;
  last_seen?: number;
  first_seen?: number;
}
export interface JobEvent {
  name: string;
  run: string;
  state: string;
  at: number;
  scheduled: number | null;
}
export interface Snapshot {
  observedAt: number;
  pebbles: Pebble[];
  alerts: Alerts | null;
  errors: { pebble: string; issues: Issue[] }[];
  jobs: { pebble: string; events: JobEvent[] }[];
  unavailable: string[];
  backup: unknown;
}
export interface OutsideObservation {
  id: string;
  observedAt: number;
  receivedAt: number;
  reachable: boolean;
}
export interface MonitorView {
  archiveEnabled?: boolean;
  snapshot: Snapshot | null;
  attemptAt: number | null;
  failure: string | null;
  outside: OutsideObservation | null;
  outsideFailure: string | null;
  journalUrl: string | null;
  publicUrl: string | null;
  history: { pebble: string; at: number; state: Health }[];
  incidents: Incident[];
  pressure: boolean;
}
export const STALE_MS = 65_000;
export function stale(snapshot: Snapshot | null, now = Date.now()) {
  return !snapshot || now - snapshot.observedAt > STALE_MS;
}
export function health(
  p: Pebble,
  now = Date.now(),
  localStale = false,
): Health {
  if (localStale) return "unk";
  if (p.status === "idle") return "idle";
  if (p.status === "stopped") return "stop";
  if (p.status === "crashed") return "bad";
  const r = p.readiness;
  if (!r?.observed_at || now - r.observed_at > STALE_MS) return "unk";
  const states: Record<string, Health> = {
    ready: "ok",
    degraded: "warn",
    failed: "bad",
    starting: "start",
    idle: "idle",
    stopped: "stop",
  };
  return states[r.state] ?? "unk";
}
export function historyBuckets(
  rows: { at: number; state: Health }[],
  now: number,
) {
  const end = Math.floor(now / 1_800_000) * 1_800_000;
  return Array.from({ length: 48 }, (_, i): Health => {
    const from = end - (47 - i) * 1_800_000,
      to = Math.min(from + 1_800_000, now + 1);
    const samples = rows
      .filter((r) => r.at >= from && r.at < to)
      .sort((a, b) => a.at - b.at);
    if (samples.some((r) => r.state === "bad" || r.state === "warn"))
      return "bad";
    if (!samples.length) return "unk";
    if (samples.every((r) => r.state === "stop")) return "stop";
    if (samples.every((r) => r.state === "idle")) return "idle";
    if (
      samples[0]!.at - from > STALE_MS ||
      to - samples.at(-1)!.at > STALE_MS ||
      samples.some((r, j) => j > 0 && r.at - samples[j - 1]!.at > STALE_MS)
    )
      return "unk";
    return samples.every((r) => r.state === "ok") ? "ok" : "unk";
  });
}

export function normalizeJob(event: JobEvent & { job?: string }): JobEvent {
  return { ...event, name: event.name ?? event.job ?? "Unknown job" };
}
