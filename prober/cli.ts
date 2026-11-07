import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { readState, record, saveState } from "./journal";
import { slot } from "./model";
import { githubNotifications, notify } from "./notify";
import { canaryUrl, probe } from "./probe";
import { build } from "./page";

const root = resolve(import.meta.dir, "..");
const status = join(root, "status");
const output = join(root, "public/dist");
async function git(args: string[], input?: string) {
  const result = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe", stdin: input === undefined ? "ignore" : new Blob([input]) });
  const [stdout, , exit] = await Promise.all([new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited]);
  if (exit) throw new Error("Git checkpoint failed. Check branch protection and workflow write permissions; rerun after repair.");
  return stdout.trim();
}
async function checkpoint() {
  if (process.env.PROBE_COMMIT !== "1") return;
  await git(["add", "--", "status"]);
  if (!(await git(["diff", "--cached", "--name-only"]))) return;
  await git(["-c", "user.name=bedrock-prober[bot]", "-c", "user.email=bedrock-prober@users.noreply.github.com", "commit", "-m", "chore(status): record external observation [skip ci]"]);
  // A human push can race the workflow concurrency group. Never overwrite it.
  await git(["fetch", "origin", process.env.PROBE_BRANCH!]);
  await git(["-c", "user.name=bedrock-prober[bot]", "-c", "user.email=bedrock-prober@users.noreply.github.com", "rebase", "FETCH_HEAD"]);
  await git(["push", "origin", `HEAD:refs/heads/${process.env.PROBE_BRANCH}`]);
}
async function scheduledAt(): Promise<string> {
  if (process.env.PROBE_SCHEDULED_AT) {
    const at = Date.parse(process.env.PROBE_SCHEDULED_AT);
    if (!Number.isFinite(at) || slot(at) !== process.env.PROBE_SCHEDULED_AT) throw new Error("Use an ISO UTC five-minute slot at :02, :07, … for PROBE_SCHEDULED_AT.");
    return process.env.PROBE_SCHEDULED_AT;
  }
  if (!process.env.GITHUB_ACTIONS) return slot(Date.now());
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^\d+$/.test(runId ?? "")) throw new Error("Workflow identity unavailable.");
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  if (!response.ok) throw new Error("Cannot identify the original workflow run. Grant actions: read and rerun.");
  const run = await response.json() as { created_at: string };
  return slot(Date.parse(run.created_at));
}
async function main() {
  const command = Bun.argv[2];
  if (command === "probe") {
    const at = await scheduledAt();
    const state = await readState(status);
    if (state.latest && at <= state.latest.scheduled_at) { console.log("Observation slot already recorded; no additional probe."); return; }
    const observation = await probe(canaryUrl(process.env.BEDROCK_CANARY_URL), at);
    await record(status, observation, Date.now());
    await checkpoint();
    console.log(JSON.stringify(observation));
  } else if (command === "notify") {
    const state = await readState(status);
    await notify(state, githubNotifications(process.env.GITHUB_REPOSITORY!, process.env.GITHUB_TOKEN!, process.env.NTFY_TOPIC_URL), async () => {
      await saveState(status, state); await checkpoint();
    }, console.log);
  } else if (command === "build") {
    await mkdir(output, { recursive: true });
    await build(status, output);
    console.log("Built dated public status page.");
  } else throw new Error("Use probe, notify or build.");
}
main().catch(() => {
  // Never print an exception from fetch, Git or configuration: it may embed a secret URL.
  console.error("Prober step failed. Check configuration, permissions and connectivity; no remote response or URL was logged.");
  process.exitCode = 1;
});
