import type { ErrorClass, Observation } from "./model";

export function canaryUrl(value: string | undefined, allowLocal = false): string {
  try {
    const url = new URL(value!);
    const local = allowLocal && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if ((!local && (url.protocol !== "https:" || !url.hostname.startsWith("bedrock."))) ||
        url.pathname !== "/healthz" || url.search || url.hash || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error("Invalid canary configuration. Set BEDROCK_CANARY_URL to https://bedrock.<domain>/healthz.");
  }
}

export async function probe(url: string, scheduledAt: string, options: {
  now?: () => number; timeoutMs?: number; fetch?: (input: string, init?: RequestInit) => Promise<Response>;
} = {}): Promise<Observation> {
  const now = options.now ?? Date.now;
  const started = performance.now();
  const observedAt = new Date(now()).toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let httpStatus: number | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const failed = (errorClass?: ErrorClass): Observation => ({
    scheduled_at: scheduledAt, observed_at: observedAt, ok: false,
    duration_ms: Math.round(performance.now() - started),
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
    ...(errorClass ? { error_class: errorClass } : {}),
  } as Observation);
  // Race the entire exchange, including a body which never completes.
  const deadline = new Promise<Observation>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(failed("timeout")), { once: true });
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await (options.fetch ?? fetch)(url, {
        method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal,
        headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
      });
      httpStatus = response.status;
      reader = response.body?.getReader();
      if (httpStatus !== 200) return failed(httpStatus >= 300 && httpStatus < 400 ? "redirect" : undefined);
      let bytes = new Uint8Array(0);
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bytes.length + value.length > 32) return failed("body_too_large");
        const joined = new Uint8Array(bytes.length + value.length);
        joined.set(bytes); joined.set(value, bytes.length); bytes = joined;
      }
      const marker = new TextEncoder().encode("bedrock-health-v1\n");
      if (bytes.length !== marker.length || bytes.some((byte, i) => byte !== marker[i])) return failed("marker_mismatch");
      return { scheduled_at: scheduledAt, observed_at: observedAt, ok: true, http_status: 200,
        duration_ms: Math.round(performance.now() - started) } satisfies Observation;
    })()]);
  } catch {
    return failed(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
    void reader?.cancel().catch(() => {});
    controller.abort();
  }
}
