import { useState } from "react";
import type { MonitorView } from "../server/model";
import type { Navigate } from "./App";
import { State, Section, Empty, Btn, date, age } from "./primitives";
import { backupState } from "./backup";
type Action = (body: unknown) => Promise<unknown>;
export function Review({
  data,
  tab,
  go,
}: {
  data: MonitorView;
  tab: string;
  go: Navigate;
}) {
  const now = Date.now();
  const [digest, setDigest] = useState(false),
    s = data.snapshot,
    backups = (s?.pebbles ?? []).filter((p) => p.backup?.last_success_at),
    issues =
      s?.errors.flatMap((g) =>
        g.issues.map((i) => ({ ...i, pebble: g.pebble })),
      ) ?? [],
    events =
      s?.jobs.flatMap((g) =>
        g.events.map((e) => ({ ...e, pebble: g.pebble })),
      ) ?? [];
  return (
    <>
      <h1>Review</h1>
      <p className="desc">
        Things to look at this week. Ordinary error issues and job failures do
        not page you.
      </p>
      <div className="tabs">
        <button
          className="tab"
          aria-pressed={!digest && tab === "review"}
          onClick={() => {
            setDigest(false);
            go("review");
          }}
        >
          Errors {issues.length}
        </button>
        <button
          className="tab"
          aria-pressed={!digest && tab === "jobs"}
          onClick={() => {
            setDigest(false);
            go("jobs");
          }}
        >
          Jobs &amp; backups
        </button>
        <button
          className="tab"
          aria-pressed={digest}
          onClick={() => setDigest(true)}
        >
          Weekly digest
        </button>
      </div>
      {digest ? (
        <div className="list">
          <div className="prow single">
            Weekly Monday 08:00 server local time · daemon-owned email digest.
            Acceptance is visible in the alert outbox.
          </div>
          {s?.alerts?.outbox
            .filter((o) => o.transition.includes("digest"))
            .map((o) => (
              <div key={o.id} className="prow simple">
                <span>{date(o.created)}</span>
                <span>{o.state}</span>
              </div>
            ))}
        </div>
      ) : tab === "review" ? (
        issues.length ? (
          <table className="table num">
            <thead>
              <tr>
                <th>Issue</th>
                <th className="hide-phone">Pebble</th>
                <th>State</th>
                <th className="hide-phone">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={`${i.pebble}:${i.id}`}>
                  <td>
                    <b>{i.title ?? i.message ?? i.type ?? i.id}</b>
                    <div className="psub">
                      {i.runtime ?? "Unknown runtime"} · {i.pebble}
                    </div>
                  </td>
                  <td className="hide-phone">{i.pebble}</td>
                  <td>{i.state ?? "Unknown"}</td>
                  <td className="hide-phone">{date(i.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No issues captured yet">
            An empty list does not prove capture works; trigger a test error
            from a pebble to check.
          </Empty>
        )
      ) : (
        <>
          {events.length ? (
            <table className="table num">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Last evidence</th>
                  <th className="hide-phone">Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 100).map((e, n) => (
                  <tr key={n}>
                    <td>
                      <b>
                        {e.pebble} · {e.name}
                      </b>
                      <div className="psub">{e.run}</div>
                    </td>
                    <td>
                      <State
                        state={
                          e.state === "succeeded"
                            ? "ok"
                            : e.state === "failed" || e.state === "interrupted"
                              ? "warn"
                              : "start"
                        }
                      >
                        {e.state}
                      </State>
                      <div className="psub">{date(e.at)}</div>
                    </td>
                    <td className="hide-phone">{date(e.scheduled)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No job runs observed yet">
              Runs appear after each pebble's first scheduled job.
            </Empty>
          )}
          <Section>Backups</Section>
          <div className="list">
              {backups.length ? (
                backups.map((p) => {
                  const b = backupState(p, now);
                  return (
                    <div className="prow simple" key={p.name}>
                      <div>
                        <div className="pname">{p.name}</div>
                        <div className="psub">
                          Last backup {age(p.backup!.last_success_at, now)}
                          {p.backup!.interval_ms ? ` · every ${Math.round(p.backup!.interval_ms / 60000)} min` : ""}
                        </div>
                      </div>
                      <State state={b.state}>{b.text}</State>
                    </div>
                  );
                })
              ) : (
                <div className="prow single">
                  <State state="unk">Backup age unavailable</State>
                  <span className="psub">
                    The daemon has not supplied backup-age evidence. An empty
                    incident list does not prove backups are current.
                  </span>
                </div>
              )}
          </div>
        </>
      )}
      {!!s?.unavailable.length && (
        <p className="notice">
          Some source APIs are unavailable. Empty sections may have incomplete
          coverage.
        </p>
      )}
    </>
  );
}
