export const INTERVAL = 5 * 60_000;
export const STALE = 15 * 60_000;
export type ErrorClass = "timeout" | "network" | "redirect" | "body_too_large" | "marker_mismatch";
export type Observation = {
  scheduled_at: string;
  observed_at: string;
  ok: boolean;
  duration_ms: number;
} & ({ http_status: number; error_class?: ErrorClass } | { error_class: ErrorClass; http_status?: number });
export type Delivery = "pending" | "claimed" | "sent" | "uncertain";
export type Transition = {
  id: string;
  incident_id: string;
  kind: "open" | "recover";
  at: string;
  issue: "pending" | "sent";
  ntfy: Delivery;
};
export type Incident = { id: string; opened_at: string; resolved_at?: string; issue_number?: number };
export type State = {
  version: 1;
  latest: Observation | null;
  last_success_at: string | null;
  failures: number;
  successes: number;
  incidents: Incident[];
  transitions: Transition[];
};
export type Daily = { date: string; expected: number; observed: number; passed: number };
export const emptyState = (): State => ({
  version: 1, latest: null, last_success_at: null, failures: 0, successes: 0, incidents: [], transitions: [],
});
export const day = (at: number | string) => new Date(at).toISOString().slice(0, 10);
export const slot = (at: number) => new Date(Math.floor((at - 120_000) / INTERVAL) * INTERVAL + 120_000).toISOString();
export const activeIncident = (state: State) => state.incidents.findLast((incident) => !incident.resolved_at);

export function apply(state: State, observation: Observation): boolean {
  // A slot is a stable identity across reruns and manual runs; late evidence cannot rewind the state.
  if (state.latest && observation.scheduled_at <= state.latest.scheduled_at) return false;
  if (state.latest && Date.parse(observation.scheduled_at) - Date.parse(state.latest.scheduled_at) > INTERVAL) {
    state.failures = state.successes = 0;
  }
  state.latest = observation;
  if (observation.ok) state.last_success_at = observation.observed_at;
  state.failures = observation.ok ? 0 : state.failures + 1;
  state.successes = observation.ok ? state.successes + 1 : 0;
  const incident = activeIncident(state);
  let transition: Transition | undefined;
  if (!incident && state.failures === 3) {
    const id = observation.scheduled_at;
    state.incidents.push({ id, opened_at: observation.observed_at });
    transition = { id: `${id}/open`, incident_id: id, kind: "open", at: observation.observed_at, issue: "pending", ntfy: "pending" };
  } else if (incident && state.successes >= 2) {
    incident.resolved_at = observation.observed_at;
    transition = { id: `${incident.id}/recover`, incident_id: incident.id, kind: "recover", at: observation.observed_at, issue: "pending", ntfy: "pending" };
  }
  if (transition) state.transitions.push(transition);
  return true;
}
