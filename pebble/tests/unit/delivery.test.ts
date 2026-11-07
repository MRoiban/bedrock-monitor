import { expect, test } from "bun:test";
import { deliveryState } from "../../web/delivery";
import type { MonitorView } from "../../server/model";

const at = 1_800_000_000_000;
const outbox = (state: string, attempts = 1) => ({ id: state, incident: null, transition: "opened", created: at, due: at, attempts, state, error: null });
const snapshot = (items: ReturnType<typeof outbox>[]) =>
  ({ observedAt: at, alerts: { incidents: [], silences: [], checks: [], outbox: items } }) as unknown as MonitorView["snapshot"];

test("historical acceptance is never green once local data is stale", () => {
  expect(deliveryState(snapshot([outbox("accepted")]), true, []).state).toBe("unk");
  expect(deliveryState(snapshot([outbox("accepted")]), false, []).state).toBe("ok");
});

test("failures outrank an older acceptance", () => {
  expect(deliveryState(snapshot([outbox("accepted"), outbox("failed")]), false, []).state).toBe("warn");
  const open = [{ rule: "alert-delivery", resolved: null }] as unknown as MonitorView["incidents"];
  expect(deliveryState(snapshot([outbox("accepted")]), false, open).state).toBe("bad");
  expect(deliveryState(snapshot([outbox("pending", 0)]), false, []).state).toBe("warn");
});
