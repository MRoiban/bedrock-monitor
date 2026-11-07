import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dir, ".."),
  out = join(root, ".bedrock/visual-capture"),
  source = resolve(root, "node_modules/bedrock/src");
const { launchDev } = await import(join(source, "cli/dev-launcher.ts"));
const home = join(root, ".bedrock/visual-first-home");
// The handoff mockup lives in the Bedrock repository; point at it explicitly.
const mockup = process.env.MONITOR_MOCKUP ?? (() => { throw new Error("Set MONITOR_MOCKUP to the Bedrock repo's design/monitoring/mockup.html."); })();
await mkdir(home, { recursive: true });
await Bun.write(
  join(home, "config.json"),
  JSON.stringify({
    domain: "localhost",
    port: 0,
    creators: ["owner@example.test"],
  }),
);
process.env.MONITOR_STATE_URL = "http://127.0.0.1:4582/missing";
process.env.MONITOR_DAILY_URL = "http://127.0.0.1:4582/missing";
const first = await launchDev({
  dir: root,
  home,
  dataDir: join(root, ".bedrock/visual-first-data"),
  port: 0,
  watch: false,
  cron: false,
});
delete process.env.MONITOR_STATE_URL;
delete process.env.MONITOR_DAILY_URL;
const b = await chromium.launch({ headless: true });
const selected = (
  process.env.MONITOR_VISUAL_SCENARIOS ?? "first,good,incident,stale"
).split(",");
const report: {
  scenario: string;
  view: string;
  theme: string;
  width: number;
  overflow: number;
  errors: string[];
  comparison: string;
}[] = (await Bun.file(join(out, "matrix.json")).exists())
  ? (await Bun.file(join(out, "matrix.json")).json()).filter(
      (r: { scenario: string }) => !selected.includes(r.scenario),
    )
  : [];
await mkdir(out, { recursive: true });
const views = [
  "overview",
  "pebbles",
  "pebble",
  "incidents",
  "incident",
  "review",
  "jobs",
  "settings",
];
async function navigate(p: Page, url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await p.goto(url);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await p.waitForTimeout(500);
    }
  }
}
async function login(p: Page, url: string) {
  await navigate(p, url);
  if (p.url().includes("login")) {
    await p
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("owner@example.test");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await p.waitForSelector("[data-bedrock-ready]");
}
try {
  for (const scenario of selected) {
    const context = await b.newContext({
        reducedMotion: "reduce",
        locale: "en-US",
        timezoneId: "Europe/Brussels",
      }),
      p = await context.newPage();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const url =
      scenario === "first" ? first.url : "http://monitor.localhost:4580/";
    if (scenario === "incident") {
      const r = await fetch("http://127.0.0.1:4582/crash", { method: "POST" });
      if (!r.ok) throw new Error("Crash simulation failed");
    }
    if (scenario === "stale") {
      await fetch("http://127.0.0.1:4582/stop-source", { method: "POST" });
    }
    await login(p, url);
    if (scenario !== "first") {
      const deadline = Date.now() + 180000;
      for (;;) {
        const ready = await p.evaluate(async (scenario) => {
          await fetch("/api/refresh", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const r = await fetch("/_bedrock/q/overview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "null",
          });
          const d = (await r.json()).value;
          return scenario === "stale"
            ? d.snapshot && Date.now() - d.snapshot.observedAt > 65000
            : scenario === "incident"
              ? d.incidents.some(
                  (i: { resolved: number | null }) => !i.resolved,
                )
              : d.snapshot &&
                d.snapshot.pebbles.some(
                  (p: { name: string; readiness: { state: string } }) =>
                    p.name === "sample" && p.readiness.state === "ready",
                );
        }, scenario);
        if (ready) break;
        if (Date.now() > deadline)
          throw new Error(`Timed out waiting for ${scenario} evidence`);
        await p.waitForTimeout(2000);
      }
    }
    for (const width of [1280, 390])
      for (const theme of ["light", "dark"])
        for (const view of views) {
          await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await p.addInitScript(
            (theme) => localStorage.setItem("monitor-theme", theme),
            theme,
          );
          const id = view === "pebble" ? "sample" : "";
          const detailResponse =
            view === "pebble" && scenario !== "first"
              ? p.waitForResponse(
                  (r) => new URL(r.url()).pathname.startsWith("/api/detail/"),
                  { timeout: 30000 },
                )
              : null;
          await navigate(p, `${url}?view=${view}${id ? `&id=${id}` : ""}`);
          await p.waitForSelector("[data-bedrock-ready]");
          await p.waitForFunction(
            () =>
              !document
                .querySelector("main")
                ?.textContent?.includes("Loading observations"),
          );
          if (scenario === "incident" || scenario === "stale")
            await p.waitForFunction(
              () =>
                Number(
                  document
                    .querySelector("main")
                    ?.getAttribute("data-incident-count"),
                ) > 0,
            );
          if (scenario === "incident" && view === "incident")
            await p.getByRole("button", { name: "Silence for 2 h" }).waitFor();
          if (view === "pebble" && scenario !== "first")
            await p
              .getByRole("heading", { name: "Requests", exact: true })
              .waitFor();
          await p.waitForTimeout(view === "pebble" ? 1000 : 250);
          if (detailResponse) {
            await detailResponse;
            await p.waitForTimeout(100);
          }
          if (scenario === "stale")
            await p
              .locator(".banner")
              .filter({ hasText: "Local data unavailable" })
              .waitFor();
          const stem = `${scenario}-${view}-${theme}-${width}`;
          await p.screenshot({
            path: join(out, `${stem}-app.png`),
            fullPage: true,
          });
          const overflow = await p.evaluate(() =>
            Math.max(0, document.documentElement.scrollWidth - innerWidth),
          );
          const mock = await b.newPage({
            viewport: { width, height: width === 390 ? 844 : 900 },
            reducedMotion: "reduce",
          });
          await mock.goto(
            `${pathToFileURL(mockup).href}?view=${view}&scn=${scenario}&theme=${theme}&width=${width === 390 ? "phone" : "desktop"}`,
          );
          await mock
            .locator("#app")
            .screenshot({ path: join(out, `${stem}-mockup.png`) });
          await mock.close();
          const comparison = `${stem}-comparison.png`,
            html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:13px system-ui;background:#ddd}main{display:flex;align-items:flex-start;gap:12px}figure{margin:0;width:${width}px}h1{font-size:14px;padding:8px;margin:0}img{width:100%;display:block}</style><main><figure><h1>Approved mockup · ${scenario} · ${view}</h1><img src="${stem}-mockup.png"></figure><figure><h1>Implementation · real temp daemon · ${scenario}</h1><img src="${stem}-app.png"></figure></main>`;
          const htmlPath = join(out, `${stem}.html`);
          await Bun.write(htmlPath, html);
          const composite = await b.newPage({
            viewport: { width: width * 2 + 12, height: 900 },
          });
          await composite.goto(`file://${htmlPath}`);
          await composite.screenshot({
            path: join(out, comparison),
            fullPage: true,
          });
          await composite.close();
          await Bun.file(htmlPath).delete();
          report.push({
            scenario,
            view,
            theme,
            width,
            overflow,
            errors: [...errors],
            comparison,
          });
          console.log(stem, `overflow=${overflow}`);
        }
    if (scenario === "incident") {
      const actions = await p.evaluate(async () => {
        const post = async (path: string, body: unknown) => {
          const r = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          return { status: r.status, body: await r.json() };
        };
        const current = await post("/_bedrock/q/overview", null);
        const fingerprint = current.body.value.incidents.find(
          (i: { resolved: number | null }) => !i.resolved,
        )?.fingerprint;
        return {
          test: await post("/api/action", { action: "test" }),
          silence: await post("/api/action", {
            action: "silence",
            fingerprint,
          }),
        };
      });
      await Bun.write(
        join(out, "actions.json"),
        JSON.stringify(actions, null, 2),
      );
      if (actions.test.status !== 200 || actions.silence.status !== 200)
        throw new Error("Alert action integration failed");
    }
    if (scenario !== "first") {
      const state = (await fetch("http://127.0.0.1:4582/state").then((r) =>
        r.json(),
      )) as { name: string; status: string }[];
      await Bun.write(
        join(out, `registry-${scenario}.json`),
        JSON.stringify(state, null, 2),
      );
      if (state.find((p) => p.name === "asleep")?.status !== "idle")
        throw new Error("Idle pebble was woken");
    }
    await context.close();
    await Bun.write(join(out, "matrix.json"), JSON.stringify(report, null, 2));
  }
} finally {
  await b.close();
  await first.stop();
}

const destination = join(root, "docs/visual-check");
await mkdir(destination, { recursive: true });
for (const row of report)
  await copyFile(join(out, row.comparison), join(destination, row.comparison));
for (const name of [
  "matrix.json",
  "actions.json",
  "registry-good.json",
  "registry-incident.json",
  "registry-stale.json",
])
  await copyFile(join(out, name), join(destination, name));
