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
import { deliveryState } from "./delivery";
import { request } from "./client";
import type { Navigate } from "./App";
import { PebbleRow } from "./Pebbles";
import { IncidentCard } from "./Incidents";
export function Overview({
  data,
  now,
  go,
}: {
  data: MonitorView;
  now: number;
  go: Navigate;
}) {
  const s = data.snapshot,
    old = stale(s, now),
    ps = s?.pebbles ?? [],
    open = data.incidents.filter((i) => !i.resolved),
    ready = ps.filter((p) => health(p, now) === "ok").length,
    unknown = ps.some((p) => ["unk", "start"].includes(health(p, now))),
    errors = s?.errors.flatMap((g) => g.issues).length ?? 0,
    delivery = deliveryState(s, old, open);
  return (
    <>
      <div
        className="verdict"
        data-tone={
          s && (old || unknown) ? "unk" : open.length ? "bad" : undefined
        }
      >
        <State
          state={
            !s ? "start" : old || unknown ? "unk" : open.length ? "bad" : "ok"
          }
        >
          <span className="sr-only">Verdict</span>
        </State>
        <div>
          <h1>
            {!s
              ? "Waiting for the first observations"
              : old || unknown
                ? "Current status unknown"
                : open.length
                  ? `${open.length} incident${open.length === 1 ? "" : "s"} ${open.length === 1 ? "needs" : "need"} attention`
                  : s.unavailable.length
                    ? "Some evidence is unavailable"
                    : "Nothing needs attention"}
          </h1>
          <p>
            {!s
              ? "Local checks start when this page is open. Set up alert delivery so pages can reach you."
              : `Last observed ${age(s.observedAt, now)} · ${ready} ready of ${ps.length} pebbles`}
          </p>
        </div>
      </div>
      <div className="evidence">
        <div className="ev">
          <b>
            <State state={!s ? "start" : old ? "unk" : "ok"}>
              Local · {!s ? "waiting" : old ? "stale" : "checks"}
            </State>
          </b>
          <span className="sub num">
            Every 30 s while viewed · {age(s?.observedAt, now)}
          </span>
        </div>
        <div className="ev">
          <b>
            <State
              state={
                !data.outside || now - data.outside.observedAt > 900000
                  ? "unk"
                  : data.outside.reachable
                    ? "ok"
                    : "bad"
              }
            >
              Outside ·{" "}
              {!data.outside
                ? "waiting"
                : now - data.outside.observedAt > 900000
                  ? "stale"
                  : data.outside.reachable
                    ? "reachable"
                    : "unreachable"}
            </State>
          </b>
          <span className="sub">
            {data.outside
              ? `Observed ${age(data.outside.observedAt, now)}`
              : "No external observation yet"}
          </span>
        </div>
        <div className="ev">
          <b>
            <State
              state={delivery.state}
            >
              Alert delivery
            </State>
          </b>
          <span className="sub">
            {delivery.text}
          </span>
        </div>
      </div>
      {open.length > 0 && (
        <>
          <Section>Open incidents</Section>
          {open.map((i) => (
            <IncidentCard key={i.id} incident={i} go={go} />
          ))}
        </>
      )}
      <Section>Fleet {s && old && "· last known"}</Section>
      <div className={`fleet num ${old ? "dim" : ""}`}>
        {[
          [s ? ready : "—", "Ready"],
          [open.length, "Needs attention"],
          [ps.filter((p) => p.status === "idle").length, "Idle · on demand"],
          [ps.filter((p) => p.memory?.hibernated_at).length, "Hibernated"],
          [ps.filter((p) => p.status === "stopped").length, "Stopped"],
        ].map(([n, label]) => (
          <div key={label}>
            <b>{n}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <Section>
        Review <span className="grow" />
        <a
          href="?view=review"
          onClick={(e) => {
            e.preventDefault();
            go("review");
          }}
        >
          Open review
        </a>
      </Section>
      {!s ? (
        <Empty title="Nothing to review yet">
          Error issues, job runs and backups appear after the first
          observations.
        </Empty>
      ) : (
        <div className="list">
          <a
            className="prow simple"
            href="?view=review"
            onClick={(e) => {
              e.preventDefault();
              go("review");
            }}
          >
            <div>
              <div className="pname">{errors} captured error issues</div>
              <div className="psub">
                Grouped exceptions · never paged individually
              </div>
            </div>
            <State state="unk">Review</State>
          </a>
          <a
            className="prow simple"
            href="?view=jobs"
            onClick={(e) => {
              e.preventDefault();
              go("jobs");
            }}
          >
            <div>
              <div className="pname">Jobs &amp; backups</div>
              <div className="psub">Last observed {age(s.observedAt, now)}</div>
            </div>
            <span>›</span>
          </a>
        </div>
      )}
      <Section>
        Running pebbles <span className="grow" />
        <a
          href="?view=pebbles"
          onClick={(e) => {
            e.preventDefault();
            go("pebbles");
          }}
        >
          All {ps.length}
        </a>
      </Section>
      {ps.length ? (
        <div className="list">
          {ps
            .filter((p) => p.status !== "stopped" && p.status !== "idle")
            .slice(0, 6)
            .map((p) => (
              <PebbleRow key={p.name} p={p} data={data} now={now} go={go} />
            ))}
        </div>
      ) : (
        <Empty title="No pebbles observed" />
      )}
      <Legend />
    </>
  );
}
