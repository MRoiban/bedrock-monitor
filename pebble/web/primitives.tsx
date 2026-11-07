import { useId, type ReactNode } from "react";
import { Button } from "@bedrock/ui";
import { historyBuckets, type Health, type Quantile } from "../server/model";
export const labels: Record<Health, string> = {
  ok: "Ready",
  warn: "Degraded",
  bad: "Not ready",
  unk: "Unknown",
  start: "Starting",
  idle: "Idle",
  stop: "Stopped",
};
export function Symbol({ state }: { state: Health }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {state === "ok" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="m4.6 8.2 2.2 2.2 4.6-4.8"
            stroke="var(--app)"
            strokeWidth="1.8"
            fill="none"
          />
        </>
      ) : state === "bad" ? (
        <>
          <path d="M5 1h6l4 4v6l-4 4H5l-4-4V5Z" fill="currentColor" />
          <path
            d="m5.5 5.5 5 5m0-5-5 5"
            stroke="var(--app)"
            strokeWidth="1.7"
          />
        </>
      ) : state === "warn" ? (
        <>
          <path d="M8 1 15 14H1Z" fill="currentColor" />
          <path d="M8 5v5m0 1v1" stroke="var(--app)" strokeWidth="1.8" />
        </>
      ) : state === "idle" ? (
        <path
          d="M11 2A6.5 6.5 0 1 0 14 10 5.2 5.2 0 0 1 11 2"
          fill="currentColor"
        />
      ) : state === "stop" ? (
        <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray={state === "unk" ? "2.5 2" : undefined}
          />
          {state === "unk" ? (
            <text
              x="8"
              y="11"
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              ?
            </text>
          ) : (
            <path
              d="M8 4v4l3 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          )}
        </>
      )}
    </svg>
  );
}
export const State = ({
  state,
  children,
}: {
  state: Health;
  children?: ReactNode;
}) => (
  <span className="st" data-s={state}>
    <Symbol state={state} />
    {children ?? labels[state]}
  </span>
);
export const Section = ({ children }: { children: ReactNode }) => (
  <div className="section-title">{children}</div>
);
export const Empty = ({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) => (
  <div className="empty">
    <h2>{title}</h2>
    {children}
  </div>
);
export const Btn = ({
  children,
  ...props
}: React.ComponentProps<typeof Button>) => (
  <Button variant="outline" className="btn" {...props}>
    {children}
  </Button>
);
export function age(at: number | null | undefined, now = Date.now()) {
  if (!at) return "not observed";
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60
    ? `${s} s ago`
    : s < 3600
      ? `${Math.floor(s / 60)} min ago`
      : s < 86400
        ? `${Math.floor(s / 3600)} h ago`
        : `${Math.floor(s / 86400)} d ago`;
}
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
/** Compact 24-hour local time: "23:52" today, "7 Nov 23:52" this year, else with the year. */
export function date(at: number | null | undefined, now = Date.now()) {
  if (!at) return "Not observed";
  const d = new Date(at), today = new Date(now);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (sameDay(d, today)) return time;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
  return `${day} ${time}`;
}
/** Status words come from the daemon in lower case; labels start with a capital. */
export const label = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export function quantile(q?: Quantile | null) {
  return q
    ? `(${q.lower * 1000}, ${q.upper === null ? "∞" : q.upper * 1000}] ms`
    : "—";
}
export const memory = (n?: number | null) =>
  n == null ? "—" : `${Math.round(n / 1024 ** 2)} MiB`;
export function Strip({
  name,
  rows,
  now,
}: {
  name: string;
  rows: { at: number; state: Health }[];
  now: number;
}) {
  const id = useId(),
    buckets = historyBuckets(rows, now);
  const summary = `${buckets.filter((s) => s === "bad").length} of 48 half-hours contain a failed check, ${buckets.filter((s) => s === "unk").length} without full evidence`;
  return (
    <svg
      className="strip"
      viewBox="0 0 286 22"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${name}, last 24 hours: ${summary}`}
    >
      <defs>
        <pattern
          id={id}
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="1" height="3" fill="var(--hatch)" />
        </pattern>
      </defs>
      {buckets.map((s, i) => (
        <rect
          key={i}
          x={i * 6}
          y={
            s === "bad"
              ? 0
              : s === "ok"
                ? 15
                : s === "idle"
                  ? 20
                  : s === "stop"
                    ? 21
                    : 8
          }
          width="4"
          height={
            s === "bad"
              ? 22
              : s === "ok"
                ? 7
                : s === "idle"
                  ? 2
                  : s === "stop"
                    ? 1
                    : 14
          }
          rx=".5"
          fill={
            s === "ok"
              ? "var(--ok)"
              : s === "bad"
                ? "var(--bad)"
                : s === "unk"
                  ? `url(#${id})`
                  : "var(--hatch)"
          }
          stroke={s === "unk" ? "var(--hatch)" : undefined}
          strokeDasharray={s === "idle" ? "1 1" : undefined}
        />
      ))}
    </svg>
  );
}
export const Legend = () => (
  <div className="legend">
    <span>
      <i style={{ background: "var(--ok)", height: 5 }} />
      All checks passed
    </span>
    <span>
      <i style={{ background: "var(--bad)" }} />
      Contains a failed check
    </span>
    <span>
      <i
        style={{
          border: "1px solid var(--hatch)",
          background:
            "repeating-linear-gradient(45deg,var(--hatch) 0 1px,transparent 1px 3px)",
        }}
      />
      Missing evidence
    </span>
    <span>·· Idle, not probed</span>
    <span>· 30 min per bar · height shows state, not latency</span>
  </div>
);
