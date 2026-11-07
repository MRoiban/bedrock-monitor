import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FunctionContext } from "bedrock";
import { RETAIN_ROWS, retain, saveSnapshot, storedBytes } from "../../server/store";

const size = (path: string) => (existsSync(path) ? statSync(path).size : 0);
const now = 1_800_000_000_000;
async function open() {
  const dir = mkdtempSync(join(tmpdir(), "monitor-cap-")), file = join(dir, "db.sqlite");
  const sqlite = new Database(file);
  sqlite.run("PRAGMA journal_mode=WAL");
  for (const f of new Bun.Glob("*.sql").scanSync("migrations")) sqlite.exec(await Bun.file(`migrations/${f}`).text());
  const db = drizzle(sqlite) as unknown as FunctionContext["db"];
  return { dir, file, sqlite, db, close: () => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a checkpoint truncates a large WAL so database plus WAL stay within the 64 MiB cap", async () => {
  const t = await open();
  try {
    const insert = t.sqlite.prepare("INSERT INTO monitor_results VALUES(?,?,?)");
    t.sqlite.transaction(() => { for (let i = 0; i < 500_000; i++) insert.run(`pebble-${i % 22}`, now - i * 1000, "ok"); })();
    t.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
    // A transaction that rewrites most pages leaves a WAL about as large as the database.
    t.sqlite.run("UPDATE monitor_results SET state='bad'");
    expect(size(`${t.file}-wal`)).toBeGreaterThan(12 * 1024 ** 2);
    t.sqlite.transaction(() => saveSnapshot(t.db, null, null, [], null, now))();
    t.sqlite.run("PRAGMA wal_checkpoint(PASSIVE)");
    expect(size(`${t.file}-wal`)).toBeLessThanOrEqual(8 * 1024 ** 2);
    expect(size(t.file) + size(`${t.file}-wal`)).toBeLessThanOrEqual(64 * 1024 ** 2);
  } finally { t.close(); }
}, 60_000);

test("one retention call deletes a bounded number of rows; the backlog drains over later calls", async () => {
  const t = await open();
  try {
    const insert = t.sqlite.prepare("INSERT INTO monitor_results VALUES(?,?,?)");
    t.sqlite.transaction(() => { for (let i = 0; i < 40_000; i++) insert.run(`pebble-${i % 22}`, now - 20 * 86_400_000 + i, "ok"); })();
    const count = () => t.sqlite.query<{ n: number }, []>("SELECT count(*) n FROM monitor_results").get()!.n;
    retain(t.db, now);
    expect(40_000 - count()).toBe(RETAIN_ROWS);
    for (let i = 0; i < Math.ceil(40_000 / RETAIN_ROWS); i++) retain(t.db, now);
    expect(count()).toBe(0);
  } finally { t.close(); }
}, 60_000);

test("near the combined cap new history is refused while the dated snapshot still updates", async () => {
  const t = await open();
  try {
    const snap = { observedAt: now, pebbles: [{ name: "fixture", status: "running", readiness: { state: "ready", observed_at: now } }],
      alerts: null, errors: [], jobs: [], unavailable: [], backup: null } as unknown as Parameters<typeof saveSnapshot>[1];
    const results = () => t.sqlite.query<{ n: number }, []>("SELECT count(*) n FROM monitor_results").get()!.n;
    (snap as any).alerts = { incidents: [{ id: "i1", fingerprint: "f", pebble: "fixture", rule: "readiness", job: "", opened: now, resolved: null, notified: null }], silences: [], checks: [], outbox: [] };
    t.sqlite.transaction(() => saveSnapshot(t.db, snap, null, [], null, now, storedBytes(t.db) + 1))();
    expect(results()).toBe(0);
    expect(t.sqlite.query<{ n: number }, []>("SELECT count(*) n FROM monitor_incidents").get()!.n).toBe(1);
    const cache = t.sqlite.query<{ pressure: number; snapshot: string }, []>("SELECT pressure, snapshot FROM monitor_cache").get()!;
    expect(cache.pressure).toBe(1);
    expect(JSON.parse(cache.snapshot).observedAt).toBe(now);
    t.sqlite.transaction(() => saveSnapshot(t.db, snap, null, [], null, now))();
    expect(results()).toBe(1);
    expect(t.sqlite.query<{ pressure: number }, []>("SELECT pressure FROM monitor_cache").get()!.pressure).toBe(0);
  } finally { t.close(); }
}, 60_000);
