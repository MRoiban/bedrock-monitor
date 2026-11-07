import { type DetachedContext, BedrockError } from "bedrock";
import { Daemon } from "./daemon";
import { importPublicJournal } from "./public-journal";
import { readView, saveSnapshot, saveDays } from "./store";
import { schema } from "./schema";
let pending: Promise<void> | undefined;
let lastAttempt = 0;
export async function refresh(ctx: DetachedContext) {
  if (pending) return pending;
  if (Date.now() - lastAttempt < 29_000) return;
  lastAttempt = Date.now();
  pending = (async () => {
    const [local, outside] = await Promise.allSettled([
      new Daemon().snapshot(),
      importPublicJournal(),
    ]);
    await ctx.write(({ db, invalidate }) => {
      saveSnapshot(
        db,
        local.status === "fulfilled" ? local.value : null,
        local.status === "rejected"
          ? "Daemon unavailable · check connection and token"
          : null,
        outside.status === "fulfilled" ? outside.value.observations : [],
        outside.status === "rejected" ? "Outside journal unavailable" : null,
      );
      if (outside.status === "fulfilled") saveDays(db, outside.value.days);
      invalidate(Object.values(schema));
    });
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
export async function action(request: Request, ctx: DetachedContext) {
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    fingerprint?: string;
    pebble?: string;
    issue?: string;
  } | null;
  const daemon = new Daemon();
  let value: unknown;
  if (body?.action === "test")
    value = await daemon.request("/api/alerts/test", {});
  else if (body?.action === "silence" && typeof body.fingerprint === "string") {
    const known = await ctx.read(({ db }) =>
      readView(db).incidents.some((i) => i.fingerprint === body.fingerprint),
    );
    if (!known)
      throw new BedrockError(
        "INVALID_INCIDENT",
        "Unknown incident.",
        "Refresh the incident list.",
      );
    value = await daemon.request("/api/alerts/silence", {
      fingerprint: body.fingerprint,
      for: "2h",
    });
  } else
    throw new BedrockError(
      "INVALID_ACTION",
      "Unknown monitoring action.",
      "Choose Send test or Silence on an incident.",
    );
  lastAttempt = 0;
  await refresh(ctx);
  return Response.json({ ok: true, value });
}
