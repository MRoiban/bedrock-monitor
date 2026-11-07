import { sqliteTable, text, integer, index, primaryKey } from "bedrock";
import type { Snapshot, OutsideObservation, Incident, Health } from "./model";
export const cache = sqliteTable("monitor_cache", {
  id: integer("id").primaryKey(),
  snapshot: text("snapshot", { mode: "json" }).$type<Snapshot>(),
  attemptAt: integer("attempt_at"),
  failure: text("failure"),
  outside: text("outside", { mode: "json" }).$type<OutsideObservation>(),
  outsideFailure: text("outside_failure"),
  pressure: integer("pressure", { mode: "boolean" }).notNull().default(false),
});
export const results = sqliteTable(
  "monitor_results",
  {
    pebble: text("pebble").notNull(),
    at: integer("at").notNull(),
    state: text("state").$type<Health>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pebble, t.at] }),
    index("results_time").on(t.at),
  ],
);
export const hours = sqliteTable(
  "monitor_hours",
  {
    pebble: text("pebble").notNull(),
    at: integer("at").notNull(),
    observed: integer("observed").notNull(),
    failed: integer("failed").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pebble, t.at] }),
    index("hours_time").on(t.at),
  ],
);
export const incidents = sqliteTable("monitor_incidents", {
  id: text("id").primaryKey(),
  value: text("value", { mode: "json" }).$type<Incident>().notNull(),
});
export const outsideResults = sqliteTable(
  "monitor_outside",
  {
    id: text("id").primaryKey(),
    observedAt: integer("observed_at").notNull(),
    receivedAt: integer("received_at").notNull(),
    reachable: integer("reachable", { mode: "boolean" }).notNull(),
  },
  (t) => [index("outside_time").on(t.observedAt)],
);
export const outsideDays = sqliteTable("monitor_outside_days", {
  date: text("date").primaryKey(),
  expected: integer("expected").notNull(),
  observed: integer("observed").notNull(),
  passed: integer("passed").notNull(),
});
export const detailCache = sqliteTable("monitor_detail_cache", {
  id: text("id").primaryKey(),
  observedAt: integer("observed_at").notNull(),
  value: text("value", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
});
export const schema = {
  cache,
  results,
  hours,
  incidents,
  outsideResults,
  outsideDays,
  detailCache,
};
