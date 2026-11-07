import { statSync } from "node:fs";
import { eq, gte, sql, type FunctionContext } from "bedrock";
import {
  cache,
  results,
  hours,
  incidents,
  outsideResults,
  outsideDays,
} from "./schema";
import { PUBLIC_PAGE, JOURNAL_BASE } from "./public-journal";
import type { PublicDay } from "./public-journal";
import {
  health,
  normalizeJob,
  type Snapshot,
  type OutsideObservation,
  type MonitorView,
} from "./model";
export const RAW_DAYS = 14,
  HOUR_DAYS = 400,
  PAGE_BUDGET = 48 * 1024 ** 2;
type DB = FunctionContext["db"];
export function readView(db: DB): MonitorView {
  const row = db.select().from(cache).get();
  return {
    archiveEnabled: process.env.MONITOR_ARCHIVE_ENABLED === "1",
    snapshot: row?.snapshot
      ? {
          ...row.snapshot,
          jobs: row.snapshot.jobs.map((group) => ({
            ...group,
            events: group.events.map(normalizeJob),
          })),
        }
      : null,
    attemptAt: row?.attemptAt ?? null,
    failure: row?.failure ?? null,
    outside: row?.outside ?? null,
    outsideFailure: row?.outsideFailure ?? null,
    pressure: row?.pressure ?? false,
    journalUrl: process.env.MONITOR_JOURNAL_URL ?? `${JOURNAL_BASE}state.json`,
    publicUrl: process.env.MONITOR_PUBLIC_URL ?? PUBLIC_PAGE,
    history: db
      .select()
      .from(results)
      .where(gte(results.at, Date.now() - 86400000))
      .all(),
    incidents: db
      .select()
      .from(incidents)
      .all()
      .map((r) => r.value),
  };
}
// The 64 MiB owner cap covers the database file and its WAL together: pages (48 MiB) + a WAL truncated
// to 8 MiB after each checkpoint + one bounded retention transaction. Deleting at most RETAIN_ROWS rows
// per call keeps that transaction's WAL small; a backlog drains over the following refreshes.
export const WAL_LIMIT = 8 * 1024 ** 2,
  RETAIN_ROWS = 4096,
  TOTAL_CAP = 64 * 1024 ** 2;
// SQLite cannot cap a WAL that a reader keeps pinned, so new history is refused (not just reclaimed)
// once database + WAL approach the owner's cap; the dated snapshot and incidents keep updating.
const fileSize = (path: string) => { try { return statSync(path).size; } catch { return 0; } };
export const storedBytes = (db: DB) => fileSize(db.$client.filename) + fileSize(`${db.$client.filename}-wal`);
export function retain(db: DB, now: number, budget = PAGE_BUDGET) {
  const sqlite = db.$client;
  let allowance = RETAIN_ROWS;
  const prune = (table: string, time: string, before?: number) => {
    const where = before === undefined ? "" : ` WHERE ${time} < ${Math.floor(before)}`;
    const deleted = sqlite.run(
      `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table}${where} ORDER BY ${time} LIMIT ${Math.min(1024, allowance)})`,
    ).changes;
    allowance -= deleted;
    return deleted;
  };
  const aged: [string, string, number][] = [
    ...(process.env.MONITOR_ARCHIVE_ENABLED === "1"
      ? []
      : [["monitor_results", "at", now - RAW_DAYS * 86400000] as [string, string, number]]),
    ["monitor_hours", "at", now - HOUR_DAYS * 86400000],
    ["monitor_outside", "observed_at", now - RAW_DAYS * 86400000],
  ];
  for (const [table, time, before] of aged)
    while (allowance > 0 && prune(table, time, before)) {}
  const used = () => {
    const pages = sqlite
      .query<{ page_count: number }, []>("PRAGMA page_count")
      .get()!.page_count;
    const free = sqlite
      .query<{ freelist_count: number }, []>("PRAGMA freelist_count")
      .get()!.freelist_count;
    return (pages - free) * 4096;
  };
  let pressure = false;
  for (const table of [
    ...(process.env.MONITOR_ARCHIVE_ENABLED === "1" ? [] : ["monitor_results"]),
    "monitor_outside",
    "monitor_hours",
  ]) {
    const time = table === "monitor_outside" ? "observed_at" : "at";
    while (allowance > 0 && used() > budget - 2 * 1024 ** 2) {
      pressure = true;
      if (!prune(table, time)) break;
    }
  }
  return pressure;
}
export function saveDays(db: DB, days: PublicDay[]) {
  for (const day of days)
    db.insert(outsideDays)
      .values(day)
      .onConflictDoUpdate({
        target: outsideDays.date,
        set: {
          expected: sql`max(${outsideDays.expected},${day.expected})`,
          observed: sql`max(${outsideDays.observed},${day.observed})`,
          passed: sql`max(${outsideDays.passed},${day.passed})`,
        },
      })
      .run();
}
export function saveSnapshot(
  db: DB,
  snapshot: Snapshot | null,
  failure: string | null,
  outside: OutsideObservation[],
  outsideFailure: string | null,
  now = Date.now(),
  cap = TOTAL_CAP,
) {
  // Reserve space for SQLite's indexes and WAL. Incidents are never evicted to admit history.
  db.$client.run(`PRAGMA max_page_count=${PAGE_BUDGET / 4096}`);
  db.$client.run(`PRAGMA journal_size_limit=${WAL_LIMIT}`);
  const shortened = retain(db, now);
  const admit = storedBytes(db) <= cap - 4 * 1024 ** 2;
  const old = db.select().from(cache).get();
  // Current pressure only: once retention and checkpoints bring storage back under, the warning clears.
  const pressure = shortened || !admit;
  const latest = outside.reduce<OutsideObservation | null>(
    (a, b) => (!a || b.observedAt > a.observedAt ? b : a),
    old?.outside ?? null,
  );
  db.insert(cache)
    .values({
      id: 1,
      snapshot: snapshot ?? old?.snapshot ?? null,
      attemptAt: now,
      failure,
      outside: latest,
      outsideFailure,
      pressure,
    })
    .onConflictDoUpdate({
      target: cache.id,
      set: {
        snapshot: snapshot ?? old?.snapshot ?? null,
        attemptAt: now,
        failure,
        outside: latest,
        outsideFailure,
        pressure,
      },
    })
    .run();
  // Near the cap only history is refused; incidents are kept forever and must stay current.
  if (admit)
    for (const r of outside)
      db.insert(outsideResults).values(r).onConflictDoNothing().run();
  if (!snapshot) return;
  for (const p of admit ? snapshot.pebbles : []) {
    const at = p.readiness?.observed_at ?? snapshot.observedAt,
      state = health(p, snapshot.observedAt);
    const inserted = db
      .insert(results)
      .values({ pebble: p.name, at, state })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!inserted) continue;
    const hour = Math.floor(at / 3600000) * 3600000,
      failed = state === "bad" || state === "warn" ? 1 : 0;
    db.insert(hours)
      .values({ pebble: p.name, at: hour, observed: 1, failed })
      .onConflictDoUpdate({
        target: [hours.pebble, hours.at],
        set: {
          observed: sql`${hours.observed}+1`,
          failed: sql`${hours.failed}+${failed}`,
        },
      })
      .run();
  }
  for (const value of snapshot.alerts?.incidents ?? []) {
    const id = `daemon:${value.id}`;
    db.insert(incidents)
      .values({ id, value: { ...value, id } })
      .onConflictDoUpdate({
        target: incidents.id,
        set: { value: { ...value, id } },
      })
      .run();
  }
}
