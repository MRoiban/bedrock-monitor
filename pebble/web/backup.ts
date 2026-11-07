import type { Health, Pebble } from "../server/model";
/** A backup is current within twice its interval (the daemon's stale-backup page rule); without an
 *  interval only its age is known, so it is never shown green. */
export function backupState(p: Pebble, now: number): { state: Health; text: string } {
  const at = p.backup?.last_success_at, every = p.backup?.interval_ms;
  if (!at) return { state: "unk", text: "No backup recorded" };
  if (!every) return { state: "unk", text: "No backup schedule" };
  return now - at > 2 * every ? { state: "warn", text: "Stale" } : { state: "ok", text: "Current" };
}
