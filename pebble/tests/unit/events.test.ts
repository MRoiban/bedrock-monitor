import { expect, test } from "bun:test";
import { eventRows } from "../../web/events";

test("a crash loop collapses into one dated row; other events keep their own tone", () => {
  const rows = [
    { time: 9, event: "retry" }, { time: 8, event: "crash" }, { time: 7, event: "spawn" },
    { time: 6, event: "retry" }, { time: 5, event: "crash" }, { time: 4, event: "spawn" },
    { time: 3, event: "ready" }, { time: 2, event: "deploy" }, { time: 1, event: "mystery" },
  ];
  expect(eventRows(rows)).toEqual([
    { from: 4, to: 9, tone: "bad", text: "Crash loop · 2 crashes, 2 retries" },
    { from: 3, to: 3, tone: "ok", text: "Ready" },
    { from: 2, to: 2, tone: "start", text: "Deployed a release" },
    { from: 1, to: 1, tone: "unk", text: "Mystery" },
  ]);
  // A single crash stays visible as itself.
  expect(eventRows([{ time: 2, event: "retry" }, { time: 1, event: "crash" }]).map((r) => r.text)).toEqual(["Retry scheduled", "Crashed"]);
});
