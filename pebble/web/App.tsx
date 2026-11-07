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
import { PebbleDetail } from "./Detail";
import { Review } from "./Review";
import { Settings } from "./Settings";
import { IncidentDetail } from "./IncidentDetail";
import { Overview } from "./Overview";
import { Pebbles } from "./Pebbles";
import { Incidents } from "./Incidents";
export type Navigate = (view: string, id?: string) => void;
const navigation = [
  [
    "overview",
    "Overview",
    "M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z",
  ],
  [
    "pebbles",
    "Pebbles",
    "M10 8a3 3 0 1 0-6 0 3 3 0 0 0 6 0M20 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0M12 17a3 3 0 1 0-6 0 3 3 0 0 0 6 0M21 17a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  ],
  ["incidents", "Incidents", "M6 17V11a6 6 0 0 1 12 0v6l2 2H4ZM10 22h4"],
  ["review", "Review", "M5 4h14v16H5ZM8 9h8M8 13h8M8 17h4"],
];
const initial = (): { view: string; id: string; range: string } => {
  const q = new URLSearchParams(location.search);
  return {
    view: q.get("view") ?? "overview",
    id: q.get("id") ?? "",
    range: q.get("range") ?? "24h",
  };
};
export function App() {
  const [route, setRoute] = useState(initial),
    [now, setNow] = useState(Date.now()),
    [notice, setNotice] = useState("");
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("monitor-theme") ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  const result = useQuery<typeof config, "overview">("overview", undefined),
    data = result.data as MonitorView | undefined;
  useEffect(() => {
    const pop = () => setRoute(initial());
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    let active = true,
      busy = false;
    const tick = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        await request("/api/refresh", {});
      } catch {
        if (active)
          setNotice(
            "Connection unavailable · showing the last dated observations",
          );
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => {
      setNow(Date.now());
      void tick();
    }, 30_000);
    const visible = () => {
      if (!document.hidden) {
        setNow(Date.now());
        void tick();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const go: Navigate = (view, id = "") => {
    const q = new URLSearchParams({
      view,
      ...(id ? { id } : {}),
      range: route.range,
    });
    history.pushState(null, "", `?${q}`);
    setRoute({ view, id, range: route.range });
    setNotice("");
    scrollTo(0, 0);
  };
  const range = (value: string) => {
    const q = new URLSearchParams(location.search);
    q.set("range", value);
    history.replaceState(null, "", `?${q}`);
    setRoute((r) => ({ ...r, range: value }));
  };
  const old = stale(data?.snapshot ?? null, now),
    open = data?.incidents.filter((i) => !i.resolved) ?? [],
    issues = data?.snapshot?.errors.flatMap((g) => g.issues) ?? [];
  const active =
    route.view === "pebble"
      ? "pebbles"
      : route.view === "incident"
        ? "incidents"
        : route.view === "jobs"
          ? "review"
          : route.view;
  const nav = (phone = false) =>
    navigation.map(([view, label, path]) => (
      <button
        key={view}
        className={phone ? undefined : "act"}
        onClick={() => go(view)}
        aria-label={
          phone
            ? undefined
            : `${label}${view === "incidents" && open.length ? ` ${open.length}` : view === "review" && issues.filter((i) => i.state === "open").length ? ` ${issues.filter((i) => i.state === "open").length}` : ""}`
        }
        aria-current={active === view ? "page" : undefined}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={path} />
        </svg>
        {phone && label}
        {view === "incidents" && open.length > 0 && (
          <span className="badge">{open.length}</span>
        )}
        {view === "review" &&
          issues.filter((i) => i.state === "open").length > 0 && (
            <span className="badge neutral">
              {issues.filter((i) => i.state === "open").length}
            </span>
          )}
      </button>
    ));
  const action = async (body: unknown) => {
    try {
      const value = await request("/api/action", body);
      setNotice(
        "Request accepted by daemon · inspect the outbox for webhook acceptance",
      );
      return value;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Action failed");
    }
  };
  let content;
  if (!data)
    content = (
      <Empty
        title={result.error ? "Monitoring unavailable" : "Loading observations"}
      >
        {result.error?.message ??
          "Waiting for the local cache. No health is assumed."}
      </Empty>
    );
  else if (route.view === "pebbles")
    content = <Pebbles data={data} now={now} go={go} />;
  else if (route.view === "pebble")
    content = (
      <PebbleDetail
        data={data}
        name={route.id || data.snapshot?.pebbles[0]?.name || ""}
        now={now}
        range={route.range}
        setRange={range}
        go={go}
      />
    );
  else if (route.view === "incidents")
    content = <Incidents data={data} go={go} />;
  else if (route.view === "incident")
    content = (
      <IncidentDetail data={data} id={route.id} go={go} action={action} />
    );
  else if (route.view === "review" || route.view === "jobs")
    content = <Review data={data} tab={route.view} go={go} />;
  else if (route.view === "settings")
    content = (
      <Settings
        data={data}
        action={action}
        theme={theme}
        setTheme={(v) => {
          setTheme(v);
          localStorage.setItem("monitor-theme", v);
        }}
      />
    );
  else content = <Overview data={data} now={now} go={go} />;
  return (
    <div className="app" data-theme={theme} data-onyx-theme-root>
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">b</span>Bedrock
        </div>
        <span className="sep">/</span>
        <span>Monitor</span>
        <span className="grow" />
        <time className="desc num wide">
          {new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "")}
          {" · "}
          {date(now, now)}
        </time>
        <button
          className="icon-btn"
          onClick={() => go("settings")}
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>
      <div className="body">
        <nav className="activity" aria-label="Monitor">
          {nav()}
        </nav>
        <main
          className="main"
          data-bedrock-ready={data ? "true" : undefined}
          data-incident-count={open.length}
          data-observed-at={data?.snapshot?.observedAt ?? "waiting"}
        >
          {old && data?.snapshot && (
            <div className="page" style={{ paddingBottom: 0 }}>
              <div className="banner">
                <State state="unk">
                  Local data unavailable · last observed{" "}
                  <time title={new Date(data.snapshot.observedAt).toISOString()}>{age(data.snapshot.observedAt, now)}</time>
                </State>
                <span className="desc">
                  Readings below are historical.
                  {data.publicUrl && (
                    <>
                      {" "}The <a href={data.publicUrl} target="_blank" rel="noreferrer">public status page</a> is independent of this box.
                    </>
                  )}
                </span>
              </div>
            </div>
          )}
          {notice && (
            <div className="page" style={{ paddingBottom: 0 }} role="status">
              {notice}
            </div>
          )}
          <div className="page">{content}</div>
        </main>
        <nav className="bottomnav" aria-label="Monitor phone">
          {nav(true)}
        </nav>
      </div>
    </div>
  );
}
