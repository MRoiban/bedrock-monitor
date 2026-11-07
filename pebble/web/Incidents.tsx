import { useEffect, useState } from "react";
import { useQuery } from "bedrock/react";
import type config from "../pebble";
import {
  stale,
  health,
  type MonitorView,
  type Pebble,
  type Incident,
} from "../server/model";
import {
  State,
  Section,
  Empty,
  Strip,
  Legend,
  Btn,
  age,
  date,
  quantile,
  memory,
} from "./primitives";
import { request } from "./client";
import type { Navigate } from "./App";
export function IncidentCard({
  incident: i,
  go,
}: {
  incident: Incident;
  go: Navigate;
}) {
  return (
    <a
      className="incident"
      href={`?view=incident&id=${encodeURIComponent(i.id)}`}
      onClick={(e) => {
        e.preventDefault();
        go("incident", i.id);
      }}
    >
      <div className="row1">
        <State state={i.resolved ? "ok" : "bad"}>
          {i.resolved ? "Resolved" : "Open"}
        </State>
        <h2>
          {i.pebble || "Home cloud"} · {i.rule}
        </h2>
        <span className="grow" />
        <span className="desc num">{age(i.opened)}</span>
      </div>
      <p>
        {i.job && `Job ${i.job} · `}Opened {date(i.opened)}
      </p>
      <div className="next">Next: inspect the incident evidence ›</div>
    </a>
  );
}
export function Incidents({ data, go }: { data: MonitorView; go: Navigate }) {
  const [tab, setTab] = useState("Open"),
    open = data.incidents.filter((i) => !i.resolved),
    resolved = data.incidents.filter((i) => i.resolved);
  return (
    <>
      <h1>Incidents</h1>
      <div className="tabs">
        {["Open", "Resolved", "Silences"].map((t) => (
          <button
            key={t}
            className="tab"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}{" "}
            {t === "Open"
              ? open.length
              : t === "Resolved"
                ? resolved.length
                : (data.snapshot?.alerts?.silences.length ?? 0)}
          </button>
        ))}
      </div>
      {tab === "Silences" ? (
        data.snapshot?.alerts?.silences.length ? (
          data.snapshot.alerts.silences.map((s) => (
            <div className="banner" key={s.fingerprint}>
              <span className="command">
                {s.fingerprint} · until {date(s.until)}
              </span>
            </div>
          ))
        ) : (
          <Empty title="No active silences" />
        )
      ) : (tab === "Open" ? open : resolved).length ? (
        (tab === "Open" ? open : resolved).map((i) => (
          <IncidentCard key={i.id} incident={i} go={go} />
        ))
      ) : (
        <Empty
          title={
            tab === "Open"
              ? "No open incidents"
              : "No resolved incidents recorded"
          }
        >
          Pages fire only for the tunnel, a pebble not ready for 2 min, a
          critical job, or a stale backup.
        </Empty>
      )}
    </>
  );
}
