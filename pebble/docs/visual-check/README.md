# Visual and integration verification

Run from `pebble/` on 2026-11-07 with Bun 1.4.3 and Playwright Chromium 1.64.0.
The source of truth was opened in Chromium from
the Bedrock repository's `design/monitoring/mockup.html` (path in `MONITOR_MOCKUP`).

## Evidence

- `bun install`: passed; linked Bedrock and UI packages resolved.
- `bun run typecheck`: passed (strict TypeScript).
- `bun test`: 17 passed, 0 failed, 57 assertions.
- `bedrock db check`: three migrations match the schema.
- `BEDROCK_HOME="$PWD/.bedrock/smoke-home" bedrock test --json`: 17 unit tests and
  16 browser cases passed; 97 passed checks, zero failures. The 16 axe-incomplete
  review entries all concern the same icon-only Settings button. Its visible
  gear, accessible name “Settings”, keyboard button semantics, and destination
  were inspected; there are zero definite WCAG A/AA violations. No claim of
  accessibility certification is made.
- `bun scripts/lab.ts`: real `bedrock dev` monitor, separate temp-home source
  daemon, strict write-slot checks, one running test pebble, one idle, one
  intentionally stopped. A fixture error and job run supply real Review data.
- `bun scripts/visual-check.ts`: eight views × four scenarios × two themes × two
  widths = 128 side-by-side comparisons; zero page overflow and zero browser
  errors. Source shutdown and the stale banner are explicit capture preconditions.
  The app's query must settle before capture; detail responses are awaited too.
- The source fixture actually exits and fails its subsequent starts; the daemon
  marks it crashed and opens the incident. Alert test and silence both return
  HTTP 200 against a loopback-only webhook setup. Test means queued, never phone
  delivery. The test receiver has no external notification destination.
- Registry snapshots before/after the incident and after daemon shutdown retain
  `asleep: idle`. No application-origin probe or lifecycle write exists in the
  monitoring adapter. No `NETWORK_IN_SLOT` failure occurred.
- After all viewers closed, collection attempts remained unchanged for 35 s.
  The source API was still stopped and the snapshot was 296,610 ms old, retaining
  its original observation date.
- Additional 320 px reflow: eight views × two themes, zero overflow. Search's
  filtered-empty state and Show all reset were exercised.
- Live public journal import read one latest observation and one daily row.
  Private archive requests were mocked; no upload to MRoiban/Lich occurred.

## Screenshots

Generated screenshots and detailed JSON evidence remain local and ignored: the
mockup includes private pebble names and must not be published with this public
fork. [index.md](index.md) links every comparison; [matrix.json](matrix.json)
records widths, themes, views, overflow, and browser errors. Raw app/mockup PNGs
remain under ignored `.bedrock/visual-capture/`.

Files use `{scenario}-{view}-{theme}-{width}-comparison.png`:

- Scenarios: `first`, `good`, `incident`, `stale`.
- Views: `overview`, `pebbles`, `pebble`, `incidents`, `incident`, `review`, `jobs`,
  `settings`.
- Themes: `light`, `dark`; widths: `1280`, `390`.

## Differences from the mockup

- The production frame fills the viewport and omits the mockup controls, outer
  margin and rounded review frame. The 38 px titlebar, 48 px activity bar, Onyx
  tokens, row/strip language, section hierarchy and phone bottom navigation are
  retained. Settings includes an actual theme control.
- Real lab data has three pebbles, not the mockup's 27. First run is genuinely
  empty, not a fabricated list of healthy known apps. The outside result is the
  independently dated live journal, not a forced scenario-specific success.
- Fresh history covers only the drill. Earlier buckets and unsupported cgroup
  memory/swap measurements are hatched or unavailable, not invented green bars
  or smooth graphs. Histogram bands, samples, errors, events and log text come
  from the daemon. More retained lifecycle events make detail pages taller.
- Incident titles/evidence use the recorded rule and timestamps. The app does not
  invent disk pressure, HEALTH_TIMEOUT counts, a restart recommendation,
  notification acceptance or escalation times. It links to actual pebble evidence
  and retains recorded opening/delivery transitions.
- Review shows real issue state and recorded job events. The fixture/API does not
  supply the mockup's exact rolling 24 h error counts, schedule/next-due or backup
  ages; those are not synthesized. Unknown backup age is stated explicitly.
- Stale text uses a neutral style and dotted underlines rather than lowered text
  opacity, because the mockup-like opacity failed WCAG contrast. Inline links are
  underlined. Count badges participate in accessible button names; the phone
  uses its visible label directly.
- The Review badge counts open issues rather than inventing an unseen/reviewed
  marker absent from the API.
- Private archive configuration is now MRoiban/Lich, opt-in via token secret,
  rather than the mockup's implied already-configured archive.

## Boundaries

No production deployment, scoped-token authorization drill, real provider/email
receipt, or private GitHub upload was performed. The SQLite main file has a tested
48 MiB page ceiling with a 64 MiB overall budget; a hard combined DB+WAL ceiling
under a pinned external reader remains unverified. Tests verify retention pressure
and preservation of incidents/awaiting-archive rows. No core Bedrock concept,
upstream Gatus file, work log, or deployed home was changed.
