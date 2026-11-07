import { useState } from "react";
import type { MonitorView } from "../server/model";
import type { Navigate } from "./App";
import { State, Section, Empty, Btn, date, age } from "./primitives";
type Action = (body: unknown) => Promise<unknown>;
export function IncidentDetail({
  data,
  id,
  go,
  action,
}: {
  data: MonitorView;
  id: string;
  go: Navigate;
  action: Action;
}) {
  const i =
      data.incidents.find((i) => i.id === id) ??
      data.incidents.find((i) => !i.resolved),
    [busy, setBusy] = useState(false);
  if (!i)
    return (
      <>
        <h1>Incident</h1>
        <Empty title="No incident selected">
          <Btn onClick={() => go("incidents")}>Back to incidents</Btn>
        </Empty>
      </>
    );
  const outbox =
      data.snapshot?.alerts?.outbox.filter(
        (o) => `daemon:${o.incident}` === i.id,
      ) ?? [],
    silence = data.snapshot?.alerts?.silences.find(
      (s) => s.fingerprint === i.fingerprint,
    );
  return (
    <>
      <div className="crumb">
        <a
          href="?view=incidents"
          onClick={(e) => {
            e.preventDefault();
            go("incidents");
          }}
        >
          Incidents
        </a>{" "}
        / {i.resolved ? "resolved" : "open"}
      </div>
      <div className="detail-head">
        <State state={i.resolved ? "ok" : "bad"}>
          {i.resolved ? "Resolved" : "Not ready"}
        </State>
        <h1>
          {i.pebble || "Home cloud"} · {i.rule}
        </h1>
      </div>
      <div className="kv num">
        <div>
          <span>Opened</span>
          <b>{date(i.opened)}</b>
        </div>
        <div>
          <span>Rule</span>
          <b>
            {i.rule}
            {i.job && ` · ${i.job}`}
          </b>
        </div>
        <div>
          <span>Notification</span>
          <b>
            {i.notified
              ? `Webhook accepted ${date(i.notified)}`
              : "No acceptance observed"}
          </b>
        </div>
        <div>
          <span>Silence</span>
          <b>{silence ? `Until ${date(silence.until)}` : "Not silenced"}</b>
        </div>
      </div>
      <Section>Latest evidence</Section>
      <div className="list">
        <div className="prow single">
          Daemon incident · {i.rule} · observed{" "}
          {date(data.snapshot?.observedAt)}
          {i.resolved && ` · resolved ${date(i.resolved)}`}
        </div>
      </div>
      <Section>What to do</Section>
      <div className="list">
        <div className="prow single">
          {i.pebble ? (
            <>
              <span>
                Inspect readiness, events and recent logs before changing the
                process.
              </span>
              <Btn onClick={() => go("pebble", i.pebble)}>
                Open pebble evidence
              </Btn>
            </>
          ) : (
            "Inspect the daemon and tunnel on the host; the independent public page may remain available."
          )}
        </div>
      </div>
      {i.pebble && (
        <div className="cmd" style={{ marginTop: 8 }}>
          <code className="mono">bedrock logs {i.pebble}</code>
          <Btn
            onClick={() =>
              navigator.clipboard.writeText(`bedrock logs ${i.pebble}`)
            }
          >
            Copy
          </Btn>
        </div>
      )}
      <Section>Timeline</Section>
      <ul className="events num">
        {[
          { time: i.opened, label: "Incident opened", state: "bad" as const },
          ...outbox.map((o) => ({
            time: o.created,
            label: `${o.transition} · ${o.state}${o.error ? ` · ${o.error}` : ""}`,
            state: "start" as const,
          })),
          ...(i.resolved
            ? [
                {
                  time: i.resolved,
                  label: "Checks recovered · incident resolved",
                  state: "ok" as const,
                },
              ]
            : []),
        ]
          .sort((a, b) => b.time - a.time)
          .map((e, n) => (
            <li key={n}>
              <time>{date(e.time)}</time>
              <State state={e.state}>
                <span className="sr-only">Event</span>
              </State>
              <span>{e.label}</span>
            </li>
          ))}
      </ul>
      <Section>Mute</Section>
      <div className="filters">
        <Btn
          disabled={busy || !!i.resolved}
          onClick={async () => {
            setBusy(true);
            try {
              await action({ action: "silence", fingerprint: i.fingerprint });
            } finally {
              setBusy(false);
            }
          }}
        >
          Silence for 2 h
        </Btn>
        <span className="desc">
          Silencing stops notifications only; the incident stays open until
          checks recover.
        </span>
      </div>
    </>
  );
}
