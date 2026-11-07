import { BedrockError } from "bedrock";
import { limitedText } from "./daemon";
import type { OutsideObservation } from "./model";
export function parseJournal(
  input: unknown,
  receivedAt: number,
): OutsideObservation[] {
  const j = input as {
    version?: number;
    v?: number;
    observations?: unknown[];
    results?: unknown[];
  };
  if (
    !j ||
    (j.version ?? j.v) !== 1 ||
    !Array.isArray(j.observations ?? j.results)
  )
    throw new BedrockError(
      "INVALID_JOURNAL",
      "Outside journal format is unsupported.",
      "Configure a version 1 public observation journal.",
    );
  return (j.observations ?? j.results ?? []).map((raw) => {
    const r = raw as {
      id?: unknown;
      observed_at?: unknown;
      observedAt?: unknown;
      reachable?: unknown;
      ok?: unknown;
      target?: unknown;
    };
    const time = r.observed_at ?? r.observedAt,
      observedAt = typeof time === "string" ? Date.parse(time) : Number(time),
      reachable = r.reachable ?? r.ok;
    if (
      typeof r.id !== "string" ||
      r.id.length > 256 ||
      !Number.isSafeInteger(observedAt) ||
      observedAt < 0 ||
      observedAt > receivedAt + 60_000 ||
      typeof reachable !== "boolean" ||
      (r.target !== undefined &&
        r.target !== "Home cloud" &&
        r.target !== "home-cloud")
    )
      throw new BedrockError(
        "INVALID_JOURNAL",
        "Outside journal contains an invalid observation.",
        "Use stable IDs, observation times and boolean reachability for Home cloud only.",
      );
    return { id: `outside:${r.id}`, observedAt, receivedAt, reachable };
  });
}
export async function importJournal(url: string | undefined) {
  if (!url) return [];
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new BedrockError(
      "INVALID_JOURNAL_URL",
      "Outside journal requires HTTPS.",
      "Use an HTTPS public journal URL.",
    );
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return [];
  if (!response.ok)
    throw new BedrockError(
      "JOURNAL_UNAVAILABLE",
      "Outside journal is unavailable.",
      "Check its URL and last published run.",
    );
  return parseJournal(
    JSON.parse(await limitedText(response, 8 * 1024 ** 2)),
    Date.now(),
  );
}
