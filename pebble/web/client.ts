import { createClient, BedrockError } from "bedrock/client";
import type config from "../pebble";
export const client = createClient<typeof config>();
export async function request<T>(path: string, body?: unknown): Promise<T> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new BedrockError(
        result.error?.code ?? "MONITOR_UNAVAILABLE",
        result.error?.message ?? "Monitoring request failed.",
        result.error?.hint ?? "Check the connection and retry.",
      );
    return result.value as T;
  } catch (error) {
    if (error instanceof BedrockError) throw error;
    throw new BedrockError(
      "MONITOR_CONNECTION",
      "Monitoring connection is unavailable.",
      "Check the server connection and retry; dated cached observations remain visible.",
    );
  }
}
