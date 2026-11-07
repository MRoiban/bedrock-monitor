import { useEffect, useState, useId } from "react";
import type { Health, MonitorView, Quantile } from "../server/model";
import { health, stale } from "../server/model";
import type { Navigate } from "./App";
import { eventRows } from "./events";
import {
  State,
  Section,
  Strip,
  Legend,
  Empty,
  Btn,
  age,
  date,
  quantile,
  memory,
  label,
} from "./primitives";
import { request } from "./client";
type Row = {
  time: number;
  starts?: number;
  completions?: number;
  failures?: number;
  traffic?: string;
  headers_success?: number[];
  value?: { resident: number | null; swap: number | null };
  event?: string;
  text?: string;
};
type Page = {
  rows: Row[];
  cursor?: string | null;
  coverage?: unknown;
  drops?: unknown;
  retained_losses?: unknown[];
};
interface Detail {
  observedAt?: number;
  unavailable?: boolean;
  metrics: Page | null;
  resources: Page | null;
  lifecycle: Page | null;
  logs: Page | null;
}
const bounds = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];
function p95(hist: number[]): Quantile | null {
  const n = hist.reduce((a, b) => a + b, 0);
  if (!n) return null;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]!;
    if (seen >= Math.ceil(n * 0.95))
      return {
        lower: i ? bounds[i - 1]! : 0,
        upper: bounds[i] ?? null,
        count: n,
        unit: "s",
      };
  }
  return null;
}
export function PebbleDetail({
  data,
  name,
  now,
  range,
  setRange,
  go,
}: {
  data: MonitorView;
  name: string;
  now: number;
  range: string;
  setRange: (r: string) => void;
  go: Navigate;
}) {
  const [detail, setDetail] = useState<{
      name: string;
      range: string;
      at: number;
      value: Detail;
    } | null>(null),
    [failed, setFailed] = useState(false),
    p = data.snapshot?.pebbles.find((p) => p.name === name);
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (name)
      request<Detail>(`/api/detail/${encodeURIComponent(name)}?range=${range}`)
        .then((value) => {
          if (active)
            setDetail({
              name,
              range,
              at: value.observedAt ?? Date.now(),
              value,
            });
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [name, range, data.snapshot?.observedAt]);
  if (!p)
    return (
      <>
        <h1>Pebble detail</h1>
        <Empty title="No pebble selected">
          <Btn onClick={() => go("pebbles")}>Choose a pebble</Btn>
        </Empty>
      </>
    );
  const d =
      detail?.name === name && detail.range === range ? detail.value : null,
    rows = d?.metrics?.rows.filter((r) => r.traffic === "ordinary") ?? [],
    count = rows.reduce((a, r) => a + (r.completions ?? 0), 0),
    failures = rows.reduce((a, r) => a + (r.failures ?? 0), 0),
    hist = Array(15).fill(0) as number[];
  rows.forEach((r) => r.headers_success?.forEach((v, i) => (hist[i]! += v)));
  const q = p95(hist),
    inc = data.incidents.find((i) => !i.resolved && i.pebble === name);
  return (
    <>
      <div className="crumb">
        <a
          href="?view=pebbles"
          onClick={(e) => {
            e.preventDefault();
            go("pebbles");
          }}
        >
          Pebbles
        </a>{" "}
        / {name}
      </div>
      <div className="detail-head">
        <h1>{name}</h1>
        <State state={health(p, now, stale(data.snapshot, now))} />
        <span className="mode">
          {p.memory?.hibernated_at ? "☾ Hibernated · running" : label(p.status)}
        </span>
        <span className="grow" />
        <span className="range">
          {["1h", "24h", "7d"].map((r) => (
            <button
              key={r}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </span>
      </div>
      {inc && (
        <div className="banner bad" style={{ marginTop: 12 }}>
          <State state="bad">Part of an open incident</State>
          <a
            href={`?view=incident&id=${inc.id}`}
            onClick={(e) => {
              e.preventDefault();
              go("incident", inc.id);
            }}
          >
            Open incident
          </a>
        </div>
      )}
      <div className="kv num">
        <div>
          <span>Readiness</span>
          <b>
            {label(p.readiness?.state ?? "unknown")} ·{" "}
            {age(p.readiness?.observed_at, now)}
          </b>
        </div>
        <div>
          <span>Requests · {range}</span>
          <b>
            {rows.length ? `${count} · ${failures} failed` : "Not observed"}
          </b>
        </div>
        <div>
          <span>p95 headers-ready</span>
          <b>{quantile(q)}</b>
        </div>
        <div>
          <span>Last backup</span>
          <b>{p?.backup?.last_success_at ? age(p.backup.last_success_at, now) : "Not recorded"}</b>
        </div>
      </div>
      <Section>History · 48 × 30 min</Section>
      <Strip
        name={name}
        rows={data.history.filter((r) => r.pebble === name)}
        now={now}
      />
      <Legend />
      <Section>Traffic and resources · {range}</Section>
      {(failed || d?.unavailable) && (
        <p className="notice">
          Detail source unavailable · cached evidence remains dated{" "}
          {date(detail?.at)}
        </p>
      )}
      <div className="charts">
        <Chart
          title="Requests"
          subtitle={
            rows.length
              ? `${count} completed · ${failures} failed · ordinary HTTP`
              : "No retained request evidence"
          }
          rows={rows}
          type="requests"
          range={range}
          now={detail?.at ?? now}
          events={d?.lifecycle?.rows ?? []}
        />
        <Chart
          title="Latency p95"
          subtitle={`Bucket range, not an exact value · ${q?.count ?? 0} samples`}
          rows={rows}
          type="latency"
          range={range}
          now={detail?.at ?? now}
          events={d?.lifecycle?.rows ?? []}
        />
        <Chart
          title="Memory"
          subtitle={`Resident ${memory(p.memory?.resident)} · swap (dashed) ${memory(p.memory?.swapped)}`}
          rows={d?.resources?.rows ?? []}
          type="memory"
          range={range}
          now={detail?.at ?? now}
          events={d?.lifecycle?.rows ?? []}
        />
        <div className="chart">
          <h3>Jobs</h3>
          {data.snapshot?.jobs
            .find((j) => j.pebble === name)
            ?.events.slice(0, 5)
            .map((j, n) => (
              <p key={n}>
                {j.name} · {j.state} · {date(j.at)}
              </p>
            ))}
          <p className="sub">
            Only observed runs are shown.{" "}
            <a
              href="?view=jobs"
              onClick={(e) => {
                e.preventDefault();
                go("jobs");
              }}
            >
              Open jobs &amp; backups
            </a>
          </p>
        </div>
      </div>
      {d?.metrics?.cursor && (
        <p className="notice">
          This chart shows a retained page; more data is available in the
          daemon.
        </p>
      )}
      <Section>Events</Section>
      {d?.lifecycle?.rows.length ? (
        <ul className="events num">
          {eventRows(d.lifecycle.rows).map((e, n) => (
            <li key={n}>
              <time>{e.from === e.to ? date(e.to) : `${date(e.from)}–${date(e.to)}`}</time>
              <State state={e.tone}>
                <span className="sr-only">Event</span>
              </State>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No lifecycle evidence in this window" />
      )}
      <Section>Recent log lines</Section>
      <pre className="log mono">
        {d?.logs?.rows.map((r) => `${date(r.time)} ${r.text}`).join("\n") ||
          "No retained log evidence in this window"}
      </pre>
      <Section>From the CLI</Section>
      <div className="cmd">
        <code className="mono">
          bedrock logs {name} --since {range}
        </code>
        <Btn
          onClick={() =>
            navigator.clipboard.writeText(
              `bedrock logs ${name} --since ${range}`,
            )
          }
        >
          Copy
        </Btn>
      </div>
    </>
  );
}
function Chart({
  title,
  subtitle,
  rows,
  type,
  range,
  now,
  events,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  type: "requests" | "latency" | "memory";
  range: string;
  now: number;
  events: Row[];
}) {
  const id = useId(),
    duration = range === "1h" ? 3600000 : range === "7d" ? 604800000 : 86400000,
    from = now - duration,
    buckets = Array.from({ length: 48 }, (_, i) =>
      rows.filter(
        (r) =>
          r.time >= from + (i * duration) / 48 &&
          r.time < from + ((i + 1) * duration) / 48,
      ),
    );
  const values = buckets.map((rs) =>
    type === "requests"
      ? rs.reduce((a, r) => a + (r.completions ?? 0), 0)
      : type === "memory"
        ? Math.max(0, ...rs.map((r) => r.value?.resident ?? 0))
        : Math.max(
            0,
            ...rs.map((r) => {
              const q = p95(r.headers_success ?? []);
              return q?.upper ?? q?.lower ?? 0;
            }),
          ),
  );
  const max = Math.max(1, ...values),
    y = (v: number) => 100 - (v / max) * 90;
  return (
    <div className="chart">
      <h3>{title}</h3>
      <div className="sub num">{subtitle}</div>
      <svg
        viewBox="0 0 300 110"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}, ${range}. Hatched buckets have no evidence. Maximum ${type === "memory" ? memory(max) : type === "latency" ? `${max * 1000} ms` : max}.`}
      >
        <defs>
          <pattern
            id={id}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="1" height="4" fill="var(--hatch)" />
          </pattern>
        </defs>
        {buckets.map((rs, i) => {
          const x = i * 6.25;
          if (!rs.length)
            return (
              <rect
                key={i}
                x={x}
                width="6"
                height="100"
                fill={`url(#${id})`}
                opacity=".5"
              />
            );
          if (type === "requests")
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y(values[i]!)}
                  width="4.4"
                  height={100 - y(values[i]!)}
                  fill="var(--strong)"
                />
                <rect
                  x={x}
                  y={y(rs.reduce((a, r) => a + (r.failures ?? 0), 0))}
                  width="4.4"
                  height={
                    100 - y(rs.reduce((a, r) => a + (r.failures ?? 0), 0))
                  }
                  fill="var(--bad)"
                />
              </g>
            );
          if (type === "latency") {
            const qs = rs
              .map((r) => p95(r.headers_success ?? []))
              .filter((q): q is Quantile => !!q);
            if (!qs.length)
              return (
                <rect
                  key={i}
                  x={x}
                  width="6"
                  height="100"
                  fill={`url(#${id})`}
                />
              );
            const lo = Math.min(...qs.map((q) => q.lower)),
              hi = Math.max(...qs.map((q) => q.upper ?? q.lower));
            return (
              <rect
                key={i}
                x={x}
                width="6"
                y={y(hi)}
                height={Math.max(1, ((hi - lo) / max) * 90)}
                fill="var(--info-bg)"
                stroke="var(--info)"
              />
            );
          }
          const r = rs.at(-1)!;
          if (r.value?.resident == null)
            return (
              <rect key={i} x={x} width="6" height="100" fill={`url(#${id})`} />
            );
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x + 5}
                y1={y(r.value.resident)}
                y2={y(r.value.resident)}
                stroke="var(--fg)"
                strokeWidth="1.5"
              />
              {r.value.swap != null && (
                <line
                  x1={x}
                  x2={x + 5}
                  y1={y(r.value.swap)}
                  y2={y(r.value.swap)}
                  stroke="var(--desc)"
                  strokeDasharray="2 2"
                />
              )}
            </g>
          );
        })}
        {events
          .filter((e) => e.time >= from && e.time <= now)
          .map((e, i) => (
            <line
              key={i}
              x1={((e.time - from) / duration) * 300}
              x2={((e.time - from) / duration) * 300}
              y1="0"
              y2="104"
              stroke="var(--info)"
              strokeDasharray="3 2"
            />
          ))}
      </svg>
      <div className="chart-axis">
        <span>{date(from)}</span>
        <span>{date(now)}</span>
      </div>
      <div className="sub">
        {events.length
          ? events
              .slice(0, 3)
              .map((e) => `${e.event} ${date(e.time)}`)
              .join(" · ")
          : "No lifecycle markers observed"}{" "}
        · gaps are not interpolated
      </div>
    </div>
  );
}
