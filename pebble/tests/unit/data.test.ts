import { describe, test, expect } from "bun:test";
import type { FunctionContext } from "bedrock";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  health,
  stale,
  historyBuckets,
  type Snapshot,
} from "../../server/model";
import { Daemon } from "../../server/daemon";
import { parseJournal } from "../../server/journal";
import {
  schema,
  cache,
  incidents,
  outsideResults,
  hours,
} from "../../server/schema";
import { saveSnapshot, retain, PAGE_BUDGET } from "../../server/store";
const now = 1_800_000_000_000;
const snapshot = (): Snapshot => ({
  observedAt: now,
  pebbles: [
    {
      name: "fixture",
      status: "running",
      readiness: { state: "ready", observed_at: now },
    },
  ],
  alerts: { incidents: [], silences: [], checks: [], outbox: [] },
  errors: [],
  jobs: [],
  unavailable: [],
  backup: null,
});
async function database() {
  const sqlite = new Database(":memory:");
  for (const f of new Bun.Glob("*.sql").scanSync("migrations"))
    sqlite.exec(await Bun.file(`migrations/${f}`).text());
  return { sqlite, db: drizzle(sqlite) as unknown as FunctionContext["db"] };
}
describe("dated evidence", () => {
  test("freshness ages out and idle/stopped modes are distinct", () => {
    const p = snapshot().pebbles[0]!;
    expect(health(p, now)).toBe("ok");
    expect(health(p, now + 65001)).toBe("unk");
    expect(health({ ...p, status: "idle" }, now)).toBe("idle");
    expect(health({ ...p, status: "stopped" }, now)).toBe("stop");
    expect(stale(null, now)).toBe(true);
    expect(stale(snapshot(), now + 65001)).toBe(true);
  });
  test("API failure preserves last successful snapshot date", async () => {
    const { sqlite, db } = await database();
    saveSnapshot(db, snapshot(), null, [], null, now);
    saveSnapshot(db, null, "unavailable", [], null, now + 70000);
    const row = db.select().from(cache).get()!;
    expect(row.snapshot?.observedAt).toBe(now);
    expect(row.failure).toBe("unavailable");
    expect(row.attemptAt).toBe(now + 70000);
    sqlite.close();
  });
  test("failed bucket wins; sparse success and absent periods are unknown", () => {
    const rows = [{ at: now - 1000, state: "ok" as const }];
    expect(historyBuckets(rows, now).filter((x) => x === "ok")).toHaveLength(0);
    expect(historyBuckets([{ at: now - 1000, state: "bad" }], now)).toContain(
      "bad",
    );
    expect(historyBuckets([], now).every((x) => x === "unk")).toBe(true);
  });
  test("repeated source observations are deduplicated in hourly summaries", async () => {
    const { sqlite, db } = await database();
    saveSnapshot(db, snapshot(), null, [], null, now);
    saveSnapshot(db, snapshot(), null, [], null, now + 30000);
    expect(db.select().from(hours).get()?.observed).toBe(1);
    sqlite.close();
  });
});
describe("bounded storage", () => {
  test("14d results, 400d rollups and forever incident retention", async () => {
    const { sqlite, db } = await database();
    const s = snapshot();
    s.alerts!.incidents = [
      {
        id: "one",
        fingerprint: "fixture",
        pebble: "fixture",
        rule: "readiness",
        job: "",
        opened: now,
        resolved: null,
        notified: null,
      },
    ];
    saveSnapshot(db, s, null, [], null, now);
    retain(db, now + 401 * 86400000);
    expect(sqlite.query("SELECT * FROM monitor_results").all()).toHaveLength(0);
    expect(db.select().from(hours).all()).toHaveLength(0);
    expect(db.select().from(incidents).all()).toHaveLength(1);
    sqlite.close();
  });
  test("byte pressure reclaims observations without deleting incidents", async () => {
    const { sqlite, db } = await database();
    const insert = sqlite.prepare("INSERT INTO monitor_results VALUES(?,?,?)");
    sqlite.transaction(() => {
      for (let i = 0; i < 40000; i++) insert.run(`fixture-${i}`, now + i, "ok");
    })();
    const before = sqlite
      .query<{ n: number }, []>("SELECT count(*) n FROM monitor_results")
      .get()!.n;
    expect(retain(db, now, 3 * 1024 ** 2)).toBe(true);
    expect(
      sqlite
        .query<{ n: number }, []>("SELECT count(*) n FROM monitor_results")
        .get()!.n,
    ).toBeLessThan(before);
    expect(
      sqlite.query<{ page_count: number }, []>("PRAGMA page_count").get()!
        .page_count * 4096,
    ).toBeLessThan(PAGE_BUDGET);
    sqlite.close();
  });
});
describe("outside imports", () => {
  test("empty journal accepted; late and duplicate records cannot revert latest", async () => {
    expect(parseJournal({ version: 1, observations: [] }, now)).toEqual([]);
    const { sqlite, db } = await database();
    const newer = parseJournal(
      {
        version: 1,
        observations: [{ id: "2", observed_at: now, reachable: true }],
      },
      now,
    );
    saveSnapshot(db, null, null, newer, null, now);
    const older = parseJournal(
      {
        version: 1,
        observations: [
          { id: "1", observed_at: now - 300000, reachable: false },
        ],
      },
      now,
    );
    saveSnapshot(db, null, null, [...older, ...newer], null, now);
    expect(db.select().from(outsideResults).all()).toHaveLength(2);
    expect(db.select().from(cache).get()?.outside?.reachable).toBe(true);
    sqlite.close();
  });
  test("rejects future, malformed and private targets", () => {
    expect(() =>
      parseJournal(
        {
          version: 1,
          observations: [
            { id: "a", observed_at: now + 60001, reachable: true },
          ],
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      parseJournal(
        {
          version: 1,
          observations: [
            {
              id: "a",
              observed_at: now,
              reachable: true,
              target: "private-app",
            },
          ],
        },
        now,
      ),
    ).toThrow();
  });
});
test("daemon collection never calls application origins, ensure, or lifecycle controls", async () => {
  const paths: string[] = [];
  const p = {
    name: "asleep",
    status: "idle",
    readiness: { state: "idle", observed_at: now },
  };
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    paths.push(`${init?.method} ${u.pathname}`);
    expect(u.origin).toBe("http://127.0.0.1:9999");
    let value: unknown = [];
    if (u.pathname === "/api/status") value = { pebbles: [p] };
    if (u.pathname === "/api/pebbles") value = [p];
    if (u.pathname.endsWith("errors")) value = { issues: [] };
    if (u.pathname.startsWith("/api/jobs/"))
      value = [
        {
          job: "tick",
          run: "retained",
          state: "succeeded",
          at: now,
          scheduled: null,
        },
      ];
    if (u.pathname === "/api/alerts")
      value = { incidents: [], silences: [], checks: [], outbox: [] };
    return Response.json({ ok: true, value });
  }) as typeof fetch;
  const s = await new Daemon(
    "http://127.0.0.1:9999",
    "opaque-token",
    transport,
  ).snapshot(now);
  expect(s.pebbles[0]?.status).toBe("idle");
  expect(s.jobs[0]?.events[0]?.name).toBe("tick");
  expect(paths).toEqual([
    "GET /api/status",
    "GET /api/pebbles",
    "GET /api/alerts",
    "GET /api/pebbles/asleep/errors",
    "GET /api/jobs/asleep/history",
  ]);
});

test("archive opt-in protects expired checks until verified export", async () => {
  const { sqlite, db } = await database();
  const saved = process.env.MONITOR_ARCHIVE_ENABLED;
  try {
    saveSnapshot(db, snapshot(), null, [], null, now);
    process.env.MONITOR_ARCHIVE_ENABLED = "1";
    retain(db, now + 15 * 86400000);
    expect(sqlite.query("SELECT * FROM monitor_results").all()).toHaveLength(1);
  } finally {
    if (saved === undefined) delete process.env.MONITOR_ARCHIVE_ENABLED;
    else process.env.MONITOR_ARCHIVE_ENABLED = saved;
    sqlite.close();
  }
});

test("collection sets a hard 48 MiB SQLite page limit inside the 64 MiB budget", async () => {
  const { sqlite, db } = await database();
  saveSnapshot(db, snapshot(), null, [], null, now);
  expect(
    sqlite.query<{ max_page_count: number }, []>("PRAGMA max_page_count").get()!
      .max_page_count * 4096,
  ).toBe(PAGE_BUDGET);
  const blob = "x".repeat(1024 ** 2);
  let admitted = 0;
  try {
    for (; admitted < 64; admitted++)
      sqlite.run("INSERT INTO monitor_detail_cache VALUES(?,?,?)", [
        String(admitted),
        now,
        blob,
      ]);
  } catch (e) {
    expect(String(e)).toContain("full");
  }
  expect(admitted).toBeLessThan(64);
  expect(
    sqlite.query<{ page_count: number }, []>("PRAGMA page_count").get()!
      .page_count * 4096,
  ).toBeLessThanOrEqual(PAGE_BUDGET);
  sqlite.close();
});
