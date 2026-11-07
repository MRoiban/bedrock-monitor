import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { canaryUrl, probe } from "./probe";
import { emptyState, type State } from "./model";
import { build } from "./page";
import { readState, record, saveState, readDaily, readRaw } from "./journal";
import { notify, type Notifications } from "./notify";

const artifacts = join(import.meta.dir, "artifacts/e2e");
test("real local HTTP outage → recovery, durable journal, mocked delivery and all public fixtures", async () => {
  await rm(artifacts, { force: true, recursive: true });
  await mkdir(artifacts, { recursive: true });
  let healthy = true;
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    requests++;
    expect(new URL(request.url).pathname).toBe("/healthz");
    return new Response(healthy ? "bedrock-health-v1\n" : "bedrock-unavailable-v1\n", { status: healthy ? 200 : 503 });
  } });
  const url = canaryUrl(`http://127.0.0.1:${server.port}/healthz`, true);
  const root = join(artifacts, "journal");
  const start = Date.parse("2026-11-07T20:12:00Z");
  const logs: string[] = [];
  const calls: string[] = [];
  const api: Notifications = {
    async findIssue() { calls.push("find"); return undefined; },
    async openIssue() { calls.push("open"); return 1; },
    async closeIssue() { calls.push("close"); },
    async postNtfy(t) { calls.push(`ntfy:${t.kind}`); },
  };
  async function fixture(name: string, state: State, now: number) {
    const status = join(artifacts, name, "status");
    await saveState(status, state);
    const daily = await readDaily(root);
    await Bun.write(join(status, "daily.jsonl"), daily.map((row) => JSON.stringify(row)).join("\n"));
    await build(status, join(artifacts, name, "page"), now);
  }
  try {
    await fixture("first-run", emptyState(), start);
    for (let i = 0; i < 7; i++) {
      healthy = i < 2 || i >= 5;
      const now = start + i * 300_000;
      const scheduled = new Date(now).toISOString();
      const observation = await probe(url, scheduled, { now: () => now });
      logs.push(JSON.stringify(observation));
      await record(root, observation, now);
      const state = await readState(root);
      await notify(state, api, () => saveState(root, state), (message) => logs.push(message));
      await saveState(root, state);
      await notify(state, api, () => saveState(root, state), (message) => logs.push(message));
      if (i === 4) await fixture("unreachable", state, now + 180_000);
      if (i === 5) await fixture("recovering", state, now);
    }
    const end = start + 6 * 300_000;
    const state = await readState(root);
    await fixture("reachable", state, end + 180_000);
    await fixture("unknown", state, end + 41 * 60_000);
    const unresolved = await Bun.file(join(artifacts, "unreachable/status/state.json")).json() as State;
    await fixture("unknown-unresolved", unresolved, end + 41 * 60_000);
    await Bun.write(join(artifacts, "actions-like.log"), logs.join("\n") + "\nBuilt dated public status page.\n");
    await Bun.write(join(artifacts, "clock.json"), JSON.stringify({
      "first-run": start, unreachable: start + 4 * 300_000 + 180_000,
      recovering: start + 5 * 300_000, reachable: end + 180_000, unknown: end + 41 * 60_000,
      "unknown-unresolved": end + 41 * 60_000,
    }));
    expect(requests).toBe(7);
    expect(await readRaw(root)).toHaveLength(7);
    expect((await readDaily(root))[0]).toEqual({ date: "2026-11-07", expected: 249, observed: 7, passed: 4 });
    expect(calls).toEqual(["find", "open", "ntfy:open", "close", "ntfy:recover"]);
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].resolved_at).toBe(new Date(end).toISOString());
    expect(state.transitions.every((t) => t.issue === "sent" && t.ntfy === "sent")).toBe(true);
  } finally { await server.stop(true); }
});

test("real server redirects are not followed, streamed marker and timeout are checked", async () => {
  let redirected = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/redirect") return Response.redirect(new URL("/target", request.url), 302);
    if (path === "/target") { redirected = true; return new Response("bedrock-health-v1\n"); }
    if (path === "/slow") { await Bun.sleep(100); return new Response("bedrock-health-v1\n"); }
    if (path === "/wrong") return new Response("bedrock-health-v2\n");
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode("bedrock-health-"));
      c.enqueue(new TextEncoder().encode("v1\n")); c.close();
    } }));
  } });
  const root = `http://127.0.0.1:${server.port}`;
  const at = new Date().toISOString();
  try {
    expect((await probe(`${root}/redirect`, at)).error_class).toBe("redirect");
    expect(redirected).toBe(false);
    expect((await probe(`${root}/slow`, at, { timeoutMs: 10 })).error_class).toBe("timeout");
    expect((await probe(`${root}/wrong`, at)).error_class).toBe("marker_mismatch");
    expect((await probe(`${root}/stream`, at)).ok).toBe(true);
  } finally { await server.stop(true); }
});
