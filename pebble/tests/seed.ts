import type { SeedContext } from "bedrock/testing";
export default function seed({ sqlite, now }: SeedContext) {
  const at = now.getTime();
  const snapshot = {
    observedAt: at,
    pebbles: [
      {
        name: "sample",
        status: "running",
        readiness: { state: "ready", observed_at: at },
        memory: { resident: 12000000, swapped: 0, hibernated_at: at },
      },
      {
        name: "asleep",
        status: "idle",
        readiness: { state: "idle", observed_at: null },
      },
      {
        name: "paused",
        status: "stopped",
        readiness: { state: "stopped", observed_at: null },
      },
    ],
    alerts: { incidents: [], silences: [], outbox: [], checks: [] },
    errors: [
      {
        pebble: "sample",
        issues: [
          {
            id: "example",
            type: "TypeError",
            runtime: "server",
            state: "open",
            first_seen: at,
            last_seen: at,
          },
        ],
      },
    ],
    jobs: [
      {
        pebble: "sample",
        events: [
          { name: "tick", run: "seed-run", state: "failed", at, scheduled: at },
        ],
      },
    ],
    unavailable: [],
    backup: null,
  };
  sqlite.run(
    "INSERT INTO monitor_cache(id,snapshot,attempt_at,pressure) VALUES(1,?,?,0)",
    [JSON.stringify(snapshot), at],
  );
  const incident = {
    id: "daemon:seed-incident",
    fingerprint: '["localhost","sample","readiness",""]',
    pebble: "sample",
    rule: "readiness",
    job: "",
    opened: at,
    resolved: null,
    notified: null,
  };
  sqlite.run("INSERT INTO monitor_incidents VALUES(?,?)", [
    incident.id,
    JSON.stringify(incident),
  ]);
}
