# Monitor pebble

A private, creator-only Bedrock monitoring application. Run from this directory:

```sh
bun install
bedrock db check
bedrock dev
```

The linked `bedrock` and `@bedrock/ui` packages must already be registered with
Bun. Runtime dependencies are Bedrock (auth, database and sync), its UI package
(Onyx components/styles), React/React DOM (client renderer), and Drizzle (same
SQLite model as Bedrock; also used in the isolated data tests). Browser testing
and TypeScript tooling are dev-only. There is no Go, Vue, chart package or
background monitoring service.

## Connection and credentials

`BEDROCK_API_URL` is supplied by Bedrock. Set the server-side
`MONITOR_TOKEN` secret to an opaque daemon token with the monitor action,
or an unscoped creator token during development. The application does not inspect
token kind. It never returns the token to a browser. (Bedrock reserves every
`BEDROCK_*` secret name, hence `MONITOR_TOKEN`.) Development source processes
inherit shell variables, so an exported temporary token works there.

Optional secrets:

- `MONITOR_API_URL`: override the injected daemon URL for an isolated external
  test daemon; normally omit it.
- `MONITOR_JOURNAL_URL`: HTTPS URL of a public version-1 Home cloud journal.
  Loopback HTTP is accepted for local integration tests. When this override is omitted, the live state/daily sources below are used.
  A missing/empty source leaves “Outside · waiting”.
- `MONITOR_PUBLIC_URL`: independent public status page URL, shown in Settings.

Create `.bedrock/daemon/config.json` with a localhost domain and your creator
email before using creator-only access with `bedrock dev`. Keep all development
state under `.bedrock/` or another temporary home; never use a deployed home.

## Collection and evidence

Visible viewers send a refresh request every 30 seconds. The detached server
handler coalesces concurrent requests, rate-limits collection across viewers,
fetches outside the write queue, and commits one dated snapshot in a short write.
No service, timer or job polls without a viewer. A closed/hidden viewer stops
requesting collection; an already-running sweep may finish. All reads use daemon
registry/telemetry APIs. No application origin, `ensure`, job listing/control or
lifecycle operation is called. Opening monitoring cannot wake an idle pebble.

Snapshot failure preserves its original observation date. Local evidence expires
after 65 seconds; outside evidence after 15 minutes. Idle and intentional stops
are neutral; hibernation is a mode independent of readiness. The daemon remains
canonical for incidents and alert rules. This pebble only projects incidents,
retains them across daemon retention, and offers test/silence actions. It never
invents a cause, acknowledgment, provider receipt or lifecycle recovery.

History contains 48 fixed half-hour buckets with coverage-aware missing evidence,
failure, idle and stopped encodings. A successful sample does not fill a missing
half hour. Charts use actual retained histogram bands/sample counts, failed
request counts and nullable memory/swap. Empty windows are hatched. The daemon
may truncate histories; a page cursor is disclosed rather than extrapolated.

Review shows observed error issues and job events; schedule/next-due/backup-age
fields that the daemon does not supply remain unavailable. Job metadata is never
fetched by waking a sleeping child. Send test means queued in the daemon outbox;
webhook acceptance remains distinct from delivery to a phone.

## Storage and journal import

Drizzle schema and committed migrations live in `server/schema.ts` and
`migrations/`. Raw observations: 14 days. Hourly summaries: 400 days. Incident
projections: never evicted. Byte pressure reclaims raw observations, outside
observations, then hourly summaries, and surfaces a persistent coverage warning.
SQLite main-file page count is capped at 48 MiB, reserving room within the 64 MiB
budget for WAL/index overhead. The runtime owns checkpointing. A hard combined
DB+WAL ceiling under a pinned external reader has **not** been established; do
not hold external database readers open. At incident-only saturation SQLite
rejects admission rather than deleting incidents.

## Optional private archive (not run during verification)

The owner-selected archive is **MRoiban/Lich**, private. With export disabled,
local raw checks expire after 14 days. To opt in, set these pebble secrets and
restart the pebble:

- `MONITOR_ARCHIVE_ENABLED=1`
- `MONITOR_ARCHIVE_GITHUB_TOKEN`: a fine-grained GitHub token restricted to
  `MRoiban/Lich` with Contents read/write and Metadata read. Never commit it or place it in a URL.

Before every upload the job reads the repository's metadata and refuses
(`ARCHIVE_NOT_PRIVATE`, local rows kept) unless it is `MRoiban/Lich` and private.
The enabled detached `archive` job runs hourly at :17 (up to 32,000 rows per run,
well above continuous-viewing ingestion). Run it explicitly
with `bedrock jobs run monitor archive`, or creator-authenticated
`POST /api/archive`. There is no archive job when the option is off. Neither
setup nor tests make GitHub writes. The repository/default branch must permit
creating contents (the Contents API can create the first file in an empty repo).

Batches contain up to 1,000 expired observations, gzip-compressed as JSONL, under
`monitor/YYYY-MM-DD/<sha256>.jsonl.gz`. Existing content-addressed files must
match; they are never overwritten. Each upload is read back before a short write
removes exactly those local rows. Retries are idempotent. A run handles at most
32 batches; later runs resume from retained rows. Export failure keeps the local
rows. While enabled, retention and pressure cleanup never evict raw checks ahead
of successful export; a full database can reject new collection until archival
catches up. Keep the token working and inspect failed job evidence. This is a
private archive of checks, not an automatic public export or database backup.

## Outside journal

By default the server reads these live public sources, without credentials:

- `https://raw.githubusercontent.com/MRoiban/bedrock-monitor/master/status/state.json`
- `https://raw.githubusercontent.com/MRoiban/bedrock-monitor/master/status/daily.jsonl`

The first supplies a dated latest observation; the second supplies daily
expected/observed/passed coverage, never synthetic raw checks. Daily totals are
stored locally and imports cannot regress already-seen counters. Stable cadence
slots deduplicate observations; late observations cannot replace newer current
evidence. Missing/empty files leave waiting states. The independent page defaults
to `https://www.roiban.xyz/bedrock-monitor/`. `MONITOR_STATE_URL`,
`MONITOR_DAILY_URL`, and `MONITOR_PUBLIC_URL` override those locations. HTTPS,
redirect rejection, an 8 MiB response cap and a 10-second deadline apply.
`MONITOR_JOURNAL_URL` optionally accepts the initial version-1 observation-array
format instead. No private data is sent to the journal or public page.

## Verification

```sh
bun install
bun run typecheck
bun test
BEDROCK_HOME="$PWD/.bedrock/test-home" bedrock test --json
```

`bun scripts/lab.ts` starts two isolated localhost daemons: a real CLI
`bedrock dev` monitor at :4580 and a source daemon at :4581 with running/idle/
stopped test pebbles. Its local-only control at :4582 supports crash and source
shutdown simulations; it creates no external resources. Stop it with SIGTERM.
`MONITOR_MOCKUP=<bedrock>/design/monitoring/mockup.html bun scripts/visual-check.ts` captures eight private views, two themes, two widths
and four scenarios, including a separate clean first-run daemon. It requires the
lab and the read-only handoff mockup at its original path. See
[visual verification](docs/visual-check/README.md) for results and differences.

Before repeating the fixture drill, stop the lab and move aside its disposable
`.bedrock/lab`, `.bedrock/db.sqlite*`, and `.bedrock/visual-first-*` data. Preserve
the previous screenshots if needed. Do not point the lab at a deployed home.
