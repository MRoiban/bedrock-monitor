import { BedrockError } from "bedrock";
import { normalizeJob } from "./model";
import type { Snapshot, Pebble, Alerts, Issue, JobEvent } from "./model";
export class Daemon {
  constructor(
    private base = process.env.MONITOR_API_URL ?? process.env.BEDROCK_API_URL,
    private token = process.env.MONITOR_TOKEN,
    private transport: typeof fetch = fetch,
  ) {}
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (!this.base || !this.token)
      throw new BedrockError(
        "MONITOR_NOT_CONFIGURED",
        "Daemon connection is not configured.",
        "Set the MONITOR_TOKEN secret: bedrock secrets set monitor MONITOR_TOKEN --restart (Bedrock reserves BEDROCK_* names).",
      );
    const response = await this.transport(new URL(path, this.base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    let result;
    try {
      result = JSON.parse(await limitedText(response, 4 * 1024 ** 2));
    } catch {
      throw new BedrockError(
        "MONITOR_RESPONSE",
        "Daemon returned an invalid response.",
        "Check the daemon connection and version.",
      );
    }
    if (!response.ok || !result.ok)
      throw new BedrockError(
        result.error?.code ?? "MONITOR_UNAVAILABLE",
        "Daemon data is unavailable.",
        "Check the token permissions and daemon status.",
      );
    return result.value as T;
  }
  async snapshot(now = Date.now()): Promise<Snapshot> {
    const status = await this.request<{
      pebbles: Pebble[];
      backups?: unknown;
      backup?: unknown;
    }>("/api/status");
    const records = await this.request<Pebble[]>("/api/pebbles");
    const pebbles = status.pebbles.map((p) => ({
      ...records.find((r) => r.name === p.name),
      ...p,
    }));
    const unavailable: string[] = [];
    const optional = async <T>(path: string, fallback: T) => {
      try {
        return await this.request<T>(path);
      } catch {
        unavailable.push(path);
        return fallback;
      }
    };
    const alerts = await optional<Alerts | null>("/api/alerts", null);
    const errors: Snapshot["errors"] = [],
      jobs: Snapshot["jobs"] = [];
    // Registry APIs only: never request a pebble origin or job-control endpoint.
    for (const p of pebbles) {
      const name = encodeURIComponent(p.name);
      const [issues, events] = await Promise.all([
        optional<{ issues: Issue[] }>(`/api/pebbles/${name}/errors`, {
          issues: [],
        }),
        optional<JobEvent[]>(`/api/jobs/${name}/history`, []),
      ]);
      errors.push({ pebble: p.name, issues: issues.issues ?? [] });
      jobs.push({ pebble: p.name, events: events.map(normalizeJob) });
    }
    return {
      observedAt: now,
      pebbles,
      alerts,
      errors,
      jobs,
      unavailable,
      // Backup evidence arrives per pebble row (`backup`); the daemon has no host-wide backup field.
      backup: null,
    };
  }
}
export async function limitedText(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new BedrockError(
          "MONITOR_RESPONSE_TOO_LARGE",
          "Monitoring response exceeds its byte budget.",
          "Use a compact journal or narrower daemon history.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}
