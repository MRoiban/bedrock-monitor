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
export function PebbleRow({
  p,
  data,
  now,
  go,
}: {
  p: Pebble;
  data: MonitorView;
  now: number;
  go: Navigate;
}) {
  const old = stale(data.snapshot, now),
    s = health(p, now, old),
    q = p.telemetry?.last_5m?.ordinary?.p95?.headers_success;
  return (
    <a
      className="prow"
      href={`?view=pebble&id=${encodeURIComponent(p.name)}`}
      onClick={(e) => {
        e.preventDefault();
        go("pebble", p.name);
      }}
    >
      <div className="c-name">
        <div className="pname">{p.name}</div>
        <div className="psub">
          {p.status === "idle" ? (
            "☾ Available on demand · not probed"
          ) : p.status === "stopped" ? (
            "■ Stopped intentionally"
          ) : p.memory?.hibernated_at ? (
            <span className="mode">☾ Hibernated · running</span>
          ) : p.next_retry_at ? (
            `Retry ${date(p.next_retry_at)}`
          ) : (
            "Running"
          )}
        </div>
      </div>
      <div className="c-state">
        <State state={s}>{old ? "Stale" : undefined}</State>
        <div className="psub">{age(p.readiness?.observed_at, now)}</div>
      </div>
      <div className="c-strip">
        <Strip
          name={p.name}
          rows={data.history.filter((r) => r.pebble === p.name)}
          now={now}
        />
      </div>
      <div className="c-metric pmetric num">
        {p.status === "idle" || p.status === "stopped" ? (
          "—"
        ) : (
          <>
            p95 {quantile(q)}
            <br />
            {memory(p.memory?.resident)}
          </>
        )}
      </div>
      <span className="c-chev desc">›</span>
    </a>
  );
}
export function Pebbles({
  data,
  now,
  go,
}: {
  data: MonitorView;
  now: number;
  go: Navigate;
}) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const ps = data.snapshot?.pebbles ?? [],
    attention = (p: Pebble) => ["bad", "warn"].includes(health(p, now));
  const groups: [string, Pebble[]][] = [
    ["Needs attention", ps.filter(attention)],
    [
      "Ready",
      ps.filter(
        (p) => p.status !== "idle" && p.status !== "stopped" && !attention(p),
      ),
    ],
    ["Available on demand", ps.filter((p) => p.status === "idle")],
    ["Stopped intentionally", ps.filter((p) => p.status === "stopped")],
  ];
  const shown = groups
    .map(
      ([label, rows]) =>
        [
          label,
          rows.filter(
            (p) =>
              p.name.includes(search) &&
              (filter === "all" ||
                (filter === "attention" && attention(p)) ||
                filter === p.status),
          ),
        ] as const,
    )
    .filter(([, rows]) => rows.length);
  return (
    <>
      <h1>Pebbles</h1>
      <div className="filters">
        <input
          className="search"
          placeholder="Search pebbles"
          aria-label="Search pebbles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {[
          ["all", "All", ps.length],
          ["attention", "Needs attention", ps.filter(attention).length],
          ["idle", "On demand", ps.filter((p) => p.status === "idle").length],
          [
            "stopped",
            "Stopped",
            ps.filter((p) => p.status === "stopped").length,
          ],
        ].map(([key, label, n]) => (
          <button
            className="filter num"
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(String(key))}
          >
            {label} {n}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="list">
          {shown.map(([label, rows]) => (
            <div key={label}>
              <div className="group-label">
                {label} · {rows.length}
              </div>
              {rows.map((p) => (
                <PebbleRow key={p.name} p={p} data={data} now={now} go={go} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No pebbles match this filter">
          <Btn
            onClick={() => {
              setFilter("all");
              setSearch("");
            }}
          >
            Show all
          </Btn>
        </Empty>
      )}
      <Legend />
    </>
  );
}
