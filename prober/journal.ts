import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { apply, day, emptyState, type Daily, type Observation, type State } from "./model";

export async function readState(root: string): Promise<State> {
  const file = Bun.file(join(root, "state.json"));
  return await file.exists() ? file.json() : emptyState();
}
export async function atomic(path: string, text: string) {
  await Bun.write(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}
export async function saveState(root: string, state: State) {
  await mkdir(root, { recursive: true });
  await atomic(join(root, "state.json"), JSON.stringify(state, null, 2) + "\n");
}
export async function readDaily(root: string): Promise<Daily[]> {
  const file = Bun.file(join(root, "daily.jsonl"));
  return await file.exists() ? (await file.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export function expected(date: string, now: number): number {
  const elapsed = now - Date.parse(`${date}T00:02:00Z`);
  return Math.max(0, Math.min(288, Math.floor(elapsed / 300_000) + 1));
}
export async function readRaw(root: string): Promise<Observation[]> {
  const dir = join(root, "raw");
  const files = await readdir(dir).catch(() => [] as string[]);
  const result: Observation[] = [];
  for (const file of files.filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()) {
    const lines = (await Bun.file(join(dir, file)).text()).trim().split("\n").filter(Boolean);
    result.push(...lines.map((line) => JSON.parse(line) as Observation));
  }
  return result;
}

export async function record(root: string, observation: Observation, now: number): Promise<boolean> {
  const state = await readState(root);
  if (state.latest && observation.scheduled_at <= state.latest.scheduled_at) return false;
  await mkdir(join(root, "raw"), { recursive: true });
  const file = join(root, "raw", `${day(observation.scheduled_at)}.jsonl`);
  const existing = await Bun.file(file).exists() ? await Bun.file(file).text() : "";
  const recorded = existing.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Observation)
    .find((row) => row.scheduled_at === observation.scheduled_at);
  // The first persisted result wins, even if a retry gets a different answer after a local crash.
  apply(state, recorded ?? observation);
  if (!recorded) await atomic(file, existing + JSON.stringify(observation) + "\n");
  await compact(root, now);
  await saveState(root, state);
  return true;
}

export async function compact(root: string, now: number) {
  const days = new Map((await readDaily(root)).map((row) => [row.date, row]));
  const raw = await readRaw(root);
  // Rebuild only retained dates; archived summaries remain authoritative forever.
  const groups = new Map<string, Observation[]>();
  for (const observation of raw) {
    const date = day(observation.scheduled_at);
    const group = groups.get(date) ?? [];
    group.push(observation); groups.set(date, group);
  }
  const first = [...days.keys(), ...groups.keys()].sort()[0];
  if (first) for (let cursor = Date.parse(first); cursor <= now; cursor += 86_400_000) {
    const date = day(cursor);
    const group = groups.get(date);
    days.set(date, { date, expected: expected(date, now),
      observed: group?.length ?? days.get(date)?.observed ?? 0,
      passed: group?.filter((o) => o.ok).length ?? days.get(date)?.passed ?? 0 });
  }
  await atomic(join(root, "daily.jsonl"), [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => JSON.stringify(row)).join("\n") + (days.size ? "\n" : ""));
  // Retain whole UTC days (today plus 89), so a partial cutoff never corrupts a daily rollup.
  const cutoff = day(now - 89 * 86_400_000);
  for (const date of groups.keys()) if (date < cutoff) await rm(join(root, "raw", `${date}.jsonl`));
}
