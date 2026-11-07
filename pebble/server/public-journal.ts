import { BedrockError } from "bedrock";
import { limitedText } from "./daemon";
import { parseJournal } from "./journal";
import type { OutsideObservation } from "./model";
export const PUBLIC_PAGE = "https://www.roiban.xyz/bedrock-monitor/";
export const JOURNAL_BASE =
  "https://raw.githubusercontent.com/MRoiban/bedrock-monitor/master/status/";
export interface PublicDay {
  date: string;
  expected: number;
  observed: number;
  passed: number;
}
function invalid(): never {
  throw new BedrockError(
    "INVALID_JOURNAL",
    "Outside journal contains invalid evidence.",
    "Use the public prober's status/state.json and status/daily.jsonl.",
  );
}
export function parseState(
  input: unknown,
  receivedAt: number,
): OutsideObservation[] {
  const state = input as {
    version?: number;
    latest?: {
      scheduled_at?: unknown;
      observed_at?: unknown;
      ok?: unknown;
    } | null;
  };
  if (!state || state.version !== 1 || !("latest" in state)) invalid();
  if (!state.latest) return [];
  const r = state.latest,
    slot = Date.parse(String(r.scheduled_at)),
    at = Date.parse(String(r.observed_at));
  if (
    !Number.isSafeInteger(slot) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    at > receivedAt + 60000 ||
    typeof r.ok !== "boolean"
  )
    invalid();
  return [
    {
      id: `outside:home-cloud:${slot}`,
      observedAt: at,
      receivedAt,
      reachable: r.ok,
    },
  ];
}
export function parseDaily(text: string): PublicDay[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      let d: PublicDay;
      try {
        d = JSON.parse(line);
      } catch {
        invalid();
      }
      if (
        !d! ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
        !Number.isFinite(Date.parse(d.date)) ||
        ![d.expected, d.observed, d.passed].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        d.passed > d.observed ||
        d.observed > d.expected
      )
        invalid();
      return {
        date: d.date,
        expected: d.expected,
        observed: d.observed,
        passed: d.passed,
      };
    });
}
async function read(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid();
  }
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname)
    )
  )
    invalid();
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new BedrockError(
      "JOURNAL_UNAVAILABLE",
      "Outside journal is unavailable.",
      "Check the public journal URL and latest run.",
    );
  return limitedText(response, 8 * 1024 ** 2);
}
export async function importPublicJournal() {
  if (process.env.MONITOR_JOURNAL_URL) {
    const text = await read(process.env.MONITOR_JOURNAL_URL);
    return {
      observations: text ? parseJournal(JSON.parse(text), Date.now()) : [],
      days: [] as PublicDay[],
    };
  }
  const state = await read(
    process.env.MONITOR_STATE_URL ?? `${JOURNAL_BASE}state.json`,
  );
  const daily = await read(
    process.env.MONITOR_DAILY_URL ?? `${JOURNAL_BASE}daily.jsonl`,
  );
  return {
    observations: state ? parseState(JSON.parse(state), Date.now()) : [],
    days: daily ? parseDaily(daily) : [],
  };
}
