import { test, expect } from "bun:test";
import {
  archiveFile,
  uploadArchive,
  archive,
  type ArchiveRow,
} from "../../server/archive";
import { parseState, parseDaily } from "../../server/public-journal";
import type { DetachedContext } from "bedrock";
const repoUrl = "https://api.github.com/repos/MRoiban/Lich";
const privateRepo = { full_name: "MRoiban/Lich", private: true };
const rows: ArchiveRow[] = [
  { pebble: "sample", at: 1700000000000, state: "ok" },
  { pebble: "asleep", at: 1700000001000, state: "idle" },
];
test("archive is deterministic, compressed JSONL and content-addressed", () => {
  const a = archiveFile(rows),
    b = archiveFile([...rows].reverse());
  expect(a).toEqual(b);
  expect(a.path).toMatch(/^monitor\/2023-11-14\/[a-f0-9]{64}\.jsonl.gz$/);
  expect(
    Buffer.from(Bun.gunzipSync(Buffer.from(a.content, "base64"))).toString(),
  ).toBe(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
});
test("archive uploads once and verifies receipt; retry never overwrites", async () => {
  let content: string | undefined,
    puts = 0;
  const transport = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === repoUrl) return Response.json(privateRepo);
    expect(String(url)).toStartWith(
      "https://api.github.com/repos/MRoiban/Lich/contents/monitor/",
    );
    if (init?.method === "PUT") {
      puts++;
      content = JSON.parse(String(init.body)).content;
      return Response.json({}, { status: 201 });
    }
    return content
      ? Response.json({ encoding: "base64", content })
      : new Response(null, { status: 404 });
  }) as typeof fetch;
  await uploadArchive(rows, "fake-token", transport);
  await uploadArchive(rows, "fake-token", transport);
  expect(puts).toBe(1);
});
test("archive rejects conflicting existing files and failed uploads", async () => {
  let put = false;
  const conflict = (async (u: unknown, init?: RequestInit) => {
    if (String(u) === repoUrl) return Response.json(privateRepo);
    if (init?.method === "PUT") put = true;
    return Response.json({ encoding: "base64", content: "different" });
  }) as typeof fetch;
  await expect(uploadArchive(rows, "fake", conflict)).rejects.toMatchObject({
    code: "ARCHIVE_CONFLICT",
  });
  expect(put).toBe(false);
  const forbidden = (async (u: unknown) =>
    String(u) === repoUrl ? Response.json(privateRepo) : new Response(null, { status: 403 })) as unknown as typeof fetch;
  await expect(uploadArchive(rows, "fake", forbidden)).rejects.toMatchObject({
    code: "ARCHIVE_UNAVAILABLE",
  });
});
test("archive refuses a repository that is not confirmed private, before any content request", async () => {
  for (const repo of [{ ...privateRepo, private: false }, { full_name: "Someone/Lich", private: true }, null]) {
    const calls: string[] = [];
    const transport = (async (u: unknown) => {
      calls.push(String(u));
      return repo ? Response.json(repo) : new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    await expect(uploadArchive(rows, "fake", transport)).rejects.toMatchObject({ code: "ARCHIVE_NOT_PRIVATE" });
    expect(calls).toEqual([repoUrl]);
  }
});
test("archive is opt-in and never contacts GitHub without configuration", async () => {
  const saved = process.env.MONITOR_ARCHIVE_ENABLED;
  delete process.env.MONITOR_ARCHIVE_ENABLED;
  try {
    await expect(archive({} as DetachedContext)).rejects.toMatchObject({
      code: "ARCHIVE_NOT_CONFIGURED",
    });
  } finally {
    if (saved !== undefined) process.env.MONITOR_ARCHIVE_ENABLED = saved;
  }
});
test("live state uses cadence identity and observed date; empty is waiting", () => {
  expect(parseState({ version: 1, latest: null }, 1800000000000)).toEqual([]);
  const parsed = parseState(
    {
      version: 1,
      latest: {
        scheduled_at: "2026-11-07T22:27:00Z",
        observed_at: "2026-11-07T22:27:28Z",
        ok: false,
      },
    },
    1800000000000,
  );
  expect(parsed[0]?.observedAt).toBe(Date.parse("2026-11-07T22:27:28Z"));
  expect(parsed[0]?.reachable).toBe(false);
  expect(parsed[0]?.id).toStartWith("outside:home-cloud:");
  expect(() =>
    parseState(
      {
        version: 1,
        latest: { scheduled_at: "bad", observed_at: "bad", ok: true },
      },
      1800000000000,
    ),
  ).toThrow();
});
test("daily journal preserves coverage counts; invalid totals fail closed", () => {
  expect(
    parseDaily(
      '{"date":"2026-11-07","expected":270,"observed":2,"passed":1}\n',
    ),
  ).toEqual([{ date: "2026-11-07", expected: 270, observed: 2, passed: 1 }]);
  expect(parseDaily("")).toEqual([]);
  expect(() =>
    parseDaily('{"date":"2026-11-07","expected":1,"observed":2,"passed":1}'),
  ).toThrow();
});
