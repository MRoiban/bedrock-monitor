// Isolated daemon + real CLI dev runner. All fixtures and credentials stay in this ignored tree.
import { mkdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { startDaemon } from "bedrock/daemon";
const source = resolve(import.meta.dir, "../node_modules/bedrock/src");
const { openDaemonDatabase } = await import(join(source, "daemon/db.ts"));
const root = resolve(import.meta.dir, "../.bedrock/lab");
await mkdir(root, { recursive: true });
const home = join(root, "source-home");
await mkdir(home, { recursive: true });
await Bun.write(
  join(home, "config.json"),
  JSON.stringify({
    domain: "localhost",
    port: 4581,
    creators: ["owner@example.test"],
    alerts: { webhook: "http://127.0.0.1:4584/messages" },
  }),
);
await Bun.write(join(home, "alerts-secret"), "lab-only-webhook-token\n");
await chmod(join(home, "alerts-secret"), 0o600);
const receiver = Bun.serve({
  hostname: "127.0.0.1",
  port: 4584,
  async fetch(request) {
    await request.arrayBuffer();
    return Response.json({ accepted: true });
  },
});
const fixture = join(root, "fixture");
await mkdir(fixture, { recursive: true });
const crashFlag = join(root, "crash-flag");
await Bun.file(crashFlag)
  .delete()
  .catch(() => {});
await Bun.write(
  join(fixture, "pebble.ts"),
  `import {definePebble,job} from "bedrock";
if(await Bun.file(${JSON.stringify(crashFlag)}).exists())process.exit(1);
export default definePebble({name:"sample",access:"public",jobs:{tick:job("*/5 * * * *",()=>console.log("Observed test job"))},routes:{"GET /":()=>new Response("Sample running"),"GET /fail":()=>{throw new Error("Example captured error")},"GET /crash":()=>{process.exit(1)}}});`,
);
await Bun.write(
  join(fixture, "package.json"),
  '{"type":"module","dependencies":{"bedrock":"link:bedrock"}}',
);
const install = Bun.spawn([process.execPath, "install"], {
  cwd: fixture,
  stdout: "ignore",
  stderr: "inherit",
});
await install.exited;
const db = await openDaemonDatabase(home);
const token = db.createToken("owner@example.test");
db.save({
  name: "sample",
  release: fixture,
  previous_release: null,
  status: "running",
});
db.save({
  name: "asleep",
  release: fixture,
  previous_release: null,
  status: "idle",
});
db.save({
  name: "paused",
  release: fixture,
  previous_release: null,
  status: "stopped",
});
db.close();
const daemon = await startDaemon({
  home,
  port: 4581,
  domain: "localhost",
  dev: true,
});
for (let n = 0; n < 3; n++)
  await fetch("http://127.0.0.1:4581/", {
    headers: { host: "sample.localhost" },
  });
await fetch("http://127.0.0.1:4581/fail", {
  headers: { host: "sample.localhost" },
});
await fetch("http://127.0.0.1:4581/api/jobs/sample?job=tick", {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
const devHome = resolve(import.meta.dir, "../.bedrock/daemon");
await mkdir(devHome, { recursive: true });
await Bun.write(
  join(devHome, "config.json"),
  JSON.stringify({
    domain: "localhost",
    port: 4580,
    creators: ["owner@example.test"],
  }),
);
const env = {
  ...process.env,
  BEDROCK_HOME: join(root, "cli-home"),
  MONITOR_TOKEN: token,
  MONITOR_API_URL: "http://127.0.0.1:4581",
  BEDROCK_STRICT_SLOTS: "1",
  MONITOR_ARCHIVE_ENABLED: "0",
  MONITOR_ARCHIVE_GITHUB_TOKEN: "",
  BEDROCK_DEV_PORT: "4580",
};
const child = Bun.spawn(
  [
    process.execPath,
    join(source, "cli/index.ts"),
    "dev",
    "--port",
    "4580",
    "--json",
  ],
  {
    cwd: resolve(import.meta.dir, ".."),
    env,
    stdout: "inherit",
    stderr: "inherit",
  },
);
let stopped = false;
const stop = async () => {
  if (stopped) return;
  stopped = true;
  child.kill("SIGTERM");
  await child.exited;
  await daemon.stop();
  receiver.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
// Test control only, loopback, no credentials returned.
let sourceStopped = false;
const control = Bun.serve({
  hostname: "127.0.0.1",
  port: 4582,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/stop-source") {
      if (!sourceStopped) {
        sourceStopped = true;
        await daemon.stop();
      }
      return new Response("stopped");
    }
    if (path === "/crash") {
      await Bun.write(crashFlag, "crash test fixture on startup");
      await fetch("http://127.0.0.1:4581/crash", {
        headers: { host: "sample.localhost" },
      }).catch(() => {});
      return new Response("crash loop armed");
    }
    if (path === "/state") {
      const d = await openDaemonDatabase(home);
      const records = d.list().map((p: { name: string; status: string }) => ({
        name: p.name,
        status: p.status,
      }));
      d.close();
      return Response.json(records);
    }
    return new Response("not found", { status: 404 });
  },
});
console.log("Lab: http://monitor.localhost:4580 · control loopback :4582");
await child.exited;
control.stop();
receiver.stop();
await daemon.stop();
