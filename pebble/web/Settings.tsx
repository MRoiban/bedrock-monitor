import { useState } from "react";
import type { MonitorView } from "../server/model";
import type { Navigate } from "./App";
import { State, Section, Empty, Btn, date, age } from "./primitives";
type Action = (body: unknown) => Promise<unknown>;
export function Settings({
  data,
  action,
  theme,
  setTheme,
}: {
  data: MonitorView;
  action: Action;
  theme: string;
  setTheme: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    s = data.snapshot;
  return (
    <>
      <h1>Settings</h1>
      <Section>Alert delivery</Section>
      <div className="list">
        <div className="prow simple">
          <div>
            <div className="pname">Daemon webhook outbox</div>
            <div className="psub">
              Quiet hours 23:00–07:30 Europe/Brussels apply to non-critical
              messages only. Acceptance is not proof of delivery to a phone.
            </div>
          </div>
          <Btn
            disabled={busy || !s?.alerts}
            onClick={async () => {
              setBusy(true);
              try {
                await action({ action: "test" });
              } finally {
                setBusy(false);
              }
            }}
          >
            Send test
          </Btn>
        </div>
      </div>
      {!s?.alerts && (
        <p className="notice">
          Alerts unavailable · configure the daemon and monitor token.
        </p>
      )}
      <Section>Outside probe</Section>
      <div className="list">
        <div className="prow simple">
          <div>
            <div className="pname">Home cloud</div>
            <div className="psub num">
              {data.outside
                ? `Observed ${date(data.outside.observedAt)} · imported ${date(data.outside.receivedAt)}`
                : "Outside · waiting · no external observation yet"}
            </div>
            <div className="psub">{data.outsideFailure}</div>
          </div>
          {data.publicUrl && (
            <a
              className="btn"
              href={data.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              View public page
            </a>
          )}
        </div>
      </div>
      <Section>What the public page shows</Section>
      <div className="list">
        <div className="prow single">
          Only “Home cloud”: whether the gateway and daemon answer from outside,
          when it was checked, and redacted outage history. No pebble names,
          counts, logs or errors.
        </div>
      </div>
      <Section>Retention</Section>
      <div className="list">
        <div className="prow single num">
          Check results 14 days · hourly summaries 400 days · incidents kept ·
          64 MiB budget. History may be shortened under byte pressure. Private
          archive: MRoiban/Lich ·{" "}
          {data.archiveEnabled ? "enabled" : "opt-in, not enabled"}. Enable with
          MONITOR_ARCHIVE_ENABLED and a MONITOR_ARCHIVE_GITHUB_TOKEN secret.
        </div>
      </div>
      {data.pressure && (
        <p className="notice">
          Storage is near its 64 MiB budget: older history is being shortened or new history paused; gaps stay unknown.
        </p>
      )}
      <Section>Connection</Section>
      <div className="list">
        <div className="prow single">
          <span>
            Daemon:{" "}
            {s
              ? `last observed ${date(s.observedAt)}`
              : "Waiting for first connection"}
          </span>
          <span className="psub">
            {data.failure ??
              "Credentials stay on the server. Set MONITOR_TOKEN with bedrock secrets set monitor."}
          </span>
        </div>
      </div>
      <Section>Appearance</Section>
      <div className="filters">
        {["light", "dark"].map((t) => (
          <Btn key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </Btn>
        ))}
      </div>
      <Section>Active silences</Section>
      {s?.alerts?.silences.length ? (
        s.alerts.silences.map((i) => (
          <div className="banner" key={i.fingerprint}>
            <span className="command">
              {i.fingerprint} · until {date(i.until)}
            </span>
          </div>
        ))
      ) : (
        <Empty title="No active silences" />
      )}
      <footer>
        Monitoring card and history language inspired by{" "}
        <a href="https://github.com/TwiN/gatus">Gatus</a> · Apache-2.0.
      </footer>
    </>
  );
}
