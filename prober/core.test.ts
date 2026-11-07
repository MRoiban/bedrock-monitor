import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { apply, emptyState, slot, type Observation, type State } from "./model";
import { compact, expected, readDaily, readRaw, readState, record, saveState } from "./journal";
import { canaryUrl, probe } from "./probe";
import { githubNotifications, notify, type Notifications } from "./notify";
import { render, snapshot } from "./page";

const origin = Date.parse("2026-11-07T12:02:00Z");
const at = (n: number) => new Date(origin + n * 300_000).toISOString();
const observation = (n: number, ok: boolean): Observation => ({ scheduled_at: at(n), observed_at: at(n), ok, http_status: ok ? 200 : 503, duration_ms: 2 });
const tempDirs: string[] = [];
const temporary = async () => { await mkdir(join(import.meta.dir, "artifacts"), { recursive: true }); const dir = await mkdtemp(join(import.meta.dir, "artifacts/test-")); tempDirs.push(dir); return dir; };
afterEach(async () => { for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

function outage(): State {
  const state = emptyState();
  for (let i = 0; i < 3; i++) apply(state, observation(i, false));
  return state;
}
function mock() {
  const calls: string[] = [];
  let number: number | undefined;
  const api: Notifications = {
    async findIssue() { calls.push("find"); return number; },
    async openIssue() { calls.push("open"); return number = 7; },
    async closeIssue() { calls.push("close"); },
    async postNtfy(t) { calls.push(`ntfy:${t.kind}`); },
  };
  return { api, calls };
}

describe("thresholds and schedule identity", () => {
  test("three consecutive failures open, two consecutive successes recover", () => {
    const state = emptyState();
    apply(state, observation(0, false)); apply(state, observation(1, false));
    expect(state.incidents).toHaveLength(0);
    apply(state, observation(2, false));
    expect(state.transitions.map((t) => t.kind)).toEqual(["open"]);
    apply(state, observation(3, true));
    expect(state.incidents[0].resolved_at).toBeUndefined();
    apply(state, observation(4, false)); apply(state, observation(5, true)); apply(state, observation(6, true));
    expect(state.transitions.map((t) => t.kind)).toEqual(["open", "recover"]);
    expect(state.incidents[0].resolved_at).toBe(at(6));
    apply(state, observation(7, true));
    expect(state.transitions).toHaveLength(2);
  });
  test("duplicate retries and older observations never count or rewind", () => {
    const state = emptyState();
    apply(state, observation(0, false));
    expect(apply(state, observation(0, false))).toBe(false);
    apply(state, observation(1, false));
    expect(apply(state, observation(0, true))).toBe(false);
    expect(state.failures).toBe(2);
    expect(state.incidents).toHaveLength(0);
  });
  test("a missing slot breaks a confirmation streak without resolving an incident", () => {
    const state = outage();
    apply(state, observation(3, true)); apply(state, observation(5, true));
    expect(state.successes).toBe(1);
    expect(state.incidents[0].resolved_at).toBeUndefined();
    const initial = emptyState();
    apply(initial, observation(0, false)); apply(initial, observation(2, false)); apply(initial, observation(3, false));
    expect(initial.incidents).toHaveLength(0);
  });
  test("cron offset is UTC and shared by retries/manual runs", () => {
    expect(slot(Date.parse("2026-11-07T12:06:59Z"))).toBe(at(0));
    expect(slot(Date.parse("2026-11-07T12:07:00Z"))).toBe(at(1));
    expect(slot(Date.parse("2026-11-07T00:00:00Z"))).toBe("2026-11-06T23:57:00.000Z");
  });
});

describe("bounded HTTP contract", () => {
  test("exact versioned marker and request policy", async () => {
    let init: RequestInit | undefined;
    const result = await probe("https://bedrock.example/healthz", at(0), { now: () => origin, fetch: (async (_url, options) => {
      init = options; return new Response("bedrock-health-v1\n");
    }) });
    expect(result.ok).toBe(true);
    expect(result.http_status).toBe(200);
    expect(init?.redirect).toBe("manual"); expect(init?.cache).toBe("no-store");
    expect(result.observed_at).toBe(at(0));
    expect(Object.keys(result).sort()).toEqual(["duration_ms", "http_status", "observed_at", "ok", "scheduled_at"]);
  });
  for (const body of ["bedrock-health-v1", "bedrock-health-v2\n", "bedrock-health-v1\nextra", "\ufeffbedrock-health-v1\n"]) {
    test(`marker mismatch ${JSON.stringify(body)}`, async () => {
      const result = await probe("unused", at(0), { fetch: (async () => new Response(body)) });
      expect(result.ok).toBe(false); expect(result.error_class).toBe("marker_mismatch");
    });
  }
  test("200 with oversized body fails without retaining bytes", async () => {
    const result = await probe("unused", at(0), { fetch: (async () => new Response("x".repeat(33))) });
    expect(result.error_class).toBe("body_too_large"); expect(JSON.stringify(result)).not.toContain("xxx");
  });
  test("redirects and non-200 success markers fail", async () => {
    for (const status of [301, 302, 503, 201]) {
      const result = await probe("unused", at(0), { fetch: (async () => new Response("bedrock-health-v1\n", { status })) });
      expect(result.ok).toBe(false); expect(result.http_status).toBe(status);
      if (status < 400 && status >= 300) expect(result.error_class).toBe("redirect");
    }
  });
  test("bounds connection timeout even when fetch ignores abort", async () => {
    const result = await probe("unused", at(0), { timeoutMs: 10, fetch: (() => new Promise(() => {})) });
    expect(result.error_class).toBe("timeout"); expect(result.duration_ms).toBeLessThan(500);
  });
  test("bounds a never-ending streamed body", async () => {
    const result = await probe("unused", at(0), { timeoutMs: 10, fetch: (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("bedrock-")); } }))) });
    expect(result.error_class).toBe("timeout"); expect(result.http_status).toBe(200);
  });
  test("network errors expose only an enum", async () => {
    const result = await probe("unused", at(0), { fetch: (async () => { throw new Error("secret URL and response bytes"); }) });
    expect(result.error_class).toBe("network"); expect(JSON.stringify(result)).not.toContain("secret");
  });
  test("canary configuration is constrained and errors never echo input", () => {
    expect(canaryUrl("https://bedrock.example/healthz")).toBe("https://bedrock.example/healthz");
    for (const url of ["https://user:password@bedrock.example/healthz", "http://bedrock.example/healthz", "https://bedrock.example/private", "https://bedrock.example/healthz?secret", "https://other.example/healthz"]) {
      expect(() => canaryUrl(url)).toThrow("Invalid canary configuration");
    }
    expect(canaryUrl("http://127.0.0.1:1234/healthz", true)).toContain("127.0.0.1");
  });
});

describe("journal retention and coverage", () => {
  test("append/dedupe is durable and raw interrupted writes are reconciled", async () => {
    const root = await temporary();
    await record(root, observation(0, true), origin);
    expect(await record(root, observation(0, false), origin)).toBe(false);
    expect(await readRaw(root)).toHaveLength(1);
    expect((await readDaily(root))[0].passed).toBe(1);
    // Simulate raw persisted but state checkpoint interrupted.
    await saveState(root, emptyState());
    await record(root, observation(0, false), origin);
    expect((await readState(root)).latest?.ok).toBe(true);
    expect(await readRaw(root)).toHaveLength(1);
    expect((await readDaily(root))[0].observed).toBe(1);
  });
  test("90 UTC raw days; permanent daily totals survive repeated compaction", async () => {
    const root = await temporary();
    const start = Date.parse("2026-07-01T00:02:00Z");
    for (let n = 0; n < 100; n++) {
      const scheduled_at = new Date(start + n * 86_400_000).toISOString();
      await Bun.write(join(root, "raw", `${scheduled_at.slice(0, 10)}.jsonl`),
        JSON.stringify({ scheduled_at, observed_at: scheduled_at, ok: n % 2 === 0, http_status: 200, duration_ms: 1 }) + "\n");
    }
    const now = start + 99 * 86_400_000;
    await compact(root, now);
    await compact(root, now);
    const rows = await readDaily(root);
    expect(await readRaw(root)).toHaveLength(90);
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ date: "2026-07-01", expected: 288, observed: 1, passed: 1 });
    expect(rows.reduce((sum, r) => sum + r.passed, 0)).toBe(50);
  });
  test("empty gap days count expected slots rather than successful observations", async () => {
    const root = await temporary();
    await record(root, observation(0, true), origin);
    await compact(root, origin + 2 * 86_400_000);
    expect((await readDaily(root))[1]).toEqual({ date: "2026-11-08", expected: 288, observed: 0, passed: 0 });
    expect(expected("2026-11-07", Date.parse("2026-11-07T00:01:59Z"))).toBe(0);
    expect(expected("2026-11-07", Date.parse("2026-11-07T00:07:00Z"))).toBe(2);
    expect(expected("2026-11-06", origin)).toBe(288);
  });
});

describe("transition delivery idempotency", () => {
  test("repeated delivery dispatches one issue and push per transition", async () => {
    const state = outage(); const { api, calls } = mock();
    let checkpoints = 0;
    const persist = async () => { checkpoints++; };
    await notify(state, api, persist, () => {}); await notify(state, api, persist, () => {});
    apply(state, observation(3, true)); apply(state, observation(4, true));
    await notify(state, api, persist, () => {}); await notify(state, api, persist, () => {});
    expect(calls).toEqual(["find", "open", "ntfy:open", "close", "ntfy:recover"]);
    expect(checkpoints).toBe(6);
  });
  test("lost issue create response reconciles by marker; failed channel does not suppress push", async () => {
    const state = outage(); const { api, calls } = mock();
    const open = api.openIssue;
    api.openIssue = async (marker, at) => { await open(marker, at); throw new Error("lost response"); };
    await notify(state, api, async () => {}, () => {});
    expect(state.transitions[0].issue).toBe("pending"); expect(state.transitions[0].ntfy).toBe("sent");
    await notify(state, api, async () => {}, () => {});
    expect(calls.filter((c) => c === "open")).toHaveLength(1);
    expect(state.transitions[0].issue).toBe("sent");
  });
  test("lost push response is uncertain and never duplicated", async () => {
    const state = outage(); const { api, calls } = mock();
    api.postNtfy = async () => { calls.push("post"); throw new Error("secret URL"); };
    const logs: string[] = [];
    await notify(state, api, async () => {}, (s) => logs.push(s));
    await notify(state, api, async () => {}, (s) => logs.push(s));
    expect(calls.filter((c) => c === "post")).toHaveLength(1);
    expect(String(state.transitions[0].ntfy)).toBe("uncertain");
    expect(logs.join()).not.toContain("secret");
  });
  test("crash after durable claim suppresses a resend", async () => {
    const state = outage(); const { api, calls } = mock();
    state.transitions[0].ntfy = "claimed";
    await notify(state, api, async () => {}, () => {});
    expect(String(state.transitions[0].ntfy)).toBe("uncertain");
    expect(calls).not.toContain("ntfy:open");
  });
  test("failed durable claim prevents any push dispatch", async () => {
    const state = outage(); const { api, calls } = mock();
    state.transitions[0].issue = "sent";
    await expect(notify(state, api, async () => { throw new Error("disk unavailable"); }, () => {})).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("static public page", () => {
  test("no-JS output is dated and a separate allowlist omits operational data", () => {
    const state = outage();
    const html = render(state, [], origin + 600_000);
    expect(html).toContain("Last observation at 2026-11-07 12:12:00 UTC: failed");
    expect(html).not.toContain("Home cloud — unreachable");
    expect(html).toContain("Page published 12:12 UTC");
    expect(JSON.stringify(snapshot(state, at(2)))).not.toContain("http_status");
    expect(html).not.toContain("issue_number"); expect(html).not.toContain("duration_ms");
  });
  test("first run has no synthetic success", () => {
    const html = render(emptyState(), [], origin);
    expect(html).toContain("Waiting for the first external observation");
    expect(html).toContain("Probe success — · coverage 0.0 %");
    expect(html).not.toContain('class="day ok"');
    expect(html.match(/class="day none"/g)).toHaveLength(120);
  });
});

test("GitHub/ntfy adapters use stable redacted bodies and reconcile only bot issues", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const marker = "<!-- home-cloud:2026-11-07T12:12:00.000Z -->";
  const adapter = githubNotifications("owner/repo", "fake-token", "https://ntfy.example/test-topic", async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("issues?")) return Response.json([
      { number: 2, body: marker, user: { login: "someone" } },
      { number: 7, body: marker, user: { login: "github-actions[bot]" } },
    ]);
    if (String(url).endsWith("/issues") && init?.method === "POST") return Response.json({ number: 7 });
    return Response.json({});
  });
  expect(await adapter.findIssue(marker)).toBe(7);
  expect(await adapter.openIssue(marker, at(2))).toBe(7);
  await adapter.closeIssue(7);
  const state = outage();
  await adapter.postNtfy(state.transitions[0]);
  const issue = JSON.parse(String(requests[1].init?.body));
  expect(issue.title).toBe("Home cloud — unreachable");
  expect(issue.body).toContain(marker);
  expect(issue.body).not.toContain("test-topic");
  expect(JSON.parse(String(requests[2].init?.body)).state).toBe("closed");
  expect(requests[3].init?.headers).toEqual({ Title: "Home cloud unreachable" });
  expect(requests[3].init?.redirect).toBe("error");
});
