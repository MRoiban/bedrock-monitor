import { definePebble, query, detached, job, BedrockError } from "bedrock";
import { archive } from "./server/archive";
import { detailCache } from "./server/schema";
import { eq } from "bedrock";
import { schema } from "./server/schema";
import { readView } from "./server/store";
import { refresh, action } from "./server/refresh";
import { Daemon } from "./server/daemon";
export default definePebble({
  name: "monitor",
  access: "creators",
  sync: true,
  schema,
  queries: { overview: query(({ db }) => readView(db)) },
  jobs:
    process.env.MONITOR_ARCHIVE_ENABLED === "1"
      ? { archive: job("17 * * * *", archive, { transaction: false }) }
      : {},
  routes: {
    "POST /api/archive": detached(async (_request, _server, ctx) =>
      Response.json({ ok: true, value: await archive(ctx) }),
    ),
    "POST /api/refresh": detached(async (_request, _server, ctx) => {
      await refresh(ctx);
      return Response.json({ ok: true });
    }),
    "POST /api/action": detached((request, _server, ctx) =>
      action(request, ctx),
    ),
    "GET /api/detail/:name": detached(async (request, _server, ctx) => {
      const url = new URL(request.url),
        name = decodeURIComponent(url.pathname.split("/").at(-1)!);
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name))
        throw new BedrockError(
          "INVALID_NAME",
          "Invalid pebble name.",
          "Choose a pebble from the list.",
        );
      const range = url.searchParams.get("range") ?? "24h";
      if (!["1h", "24h", "7d"].includes(range))
        throw new BedrockError(
          "INVALID_RANGE",
          "Invalid detail range.",
          "Choose 1h, 24h or 7d.",
        );
      const d = new Daemon(),
        base = `/api/pebbles/${name}`;
      const parts = await Promise.allSettled([
        d.request(
          `${base}/metrics?since=${range}&step=${range === "1h" ? "1m" : "1h"}`,
        ),
        d.request(`${base}/resources?since=${range}`),
        d.request(`${base}/lifecycle?since=${range}`),
        d.request(`${base}/logs?since=${range}&limit=30`),
      ]);
      const key = `${name}:${range}`;
      const previous = await ctx.read(({ db }) =>
        db.select().from(detailCache).where(eq(detailCache.id, key)).get(),
      );
      const unavailable = parts.some((p) => p.status === "rejected");
      if (unavailable && previous)
        return Response.json({
          ok: true,
          value: {
            ...previous.value,
            observedAt: previous.observedAt,
            unavailable: true,
          },
        });
      const value = Object.fromEntries(
        ["metrics", "resources", "lifecycle", "logs"].map((k, i) => [
          k,
          parts[i]!.status === "fulfilled" ? parts[i]!.value : null,
        ]),
      );
      const observedAt = Date.now();
      if (!unavailable && Buffer.byteLength(JSON.stringify(value)) <= 1024 ** 2)
        await ctx.write(({ db }) => {
          db.insert(detailCache)
            .values({ id: key, observedAt, value })
            .onConflictDoUpdate({
              target: detailCache.id,
              set: { observedAt, value },
            })
            .run();
          db.$client.run(
            "DELETE FROM monitor_detail_cache WHERE id IN (SELECT id FROM monitor_detail_cache ORDER BY observed_at DESC LIMIT -1 OFFSET 24)",
          );
        });
      return Response.json({
        ok: true,
        value: { ...value, observedAt, unavailable },
      });
    }),
  },
  web: "./web/index.html",
});
