import { expect, test } from "bun:test";
import { backupState } from "../../web/backup";

const now = 1_800_000_000_000, hour = 3_600_000;
const pebble = (backup: { last_success_at: number | null; interval_ms: number | null } | null) => ({ name: "p", status: "running", backup });

test("backup evidence comes from each pebble row and goes stale after twice its interval", () => {
  expect(backupState(pebble({ last_success_at: now - hour, interval_ms: hour }), now)).toEqual({ state: "ok", text: "Current" });
  expect(backupState(pebble({ last_success_at: now - 3 * hour, interval_ms: hour }), now).state).toBe("warn");
  expect(backupState(pebble({ last_success_at: now - hour, interval_ms: null }), now).state).toBe("unk");
  expect(backupState(pebble(null), now).state).toBe("unk");
});
