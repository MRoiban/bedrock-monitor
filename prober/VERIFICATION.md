# M5c local verification

Branch `prober`.
Base: `4b84fa2d`. Only this worktree was written; no WORKLOG was edited.
No GitHub API calls, pushes, Actions enablement, secrets or resource creation.
The production journal is an empty first-run journal. Synthetic history lives
only in ignored test artifacts.

## Commands and results

Run on Linux, Bun 1.4.3, Node 24.22.0; all paths below are relative to this repo.

| Command | Result |
| --- | --- |
| `bun install --cwd prober` | Pass; 5 installed dev packages checked, lock unchanged on repeat |
| `bun run --cwd prober typecheck` | Pass; strict TypeScript, no emitted files |
| `bun test prober` | **28 pass, 0 fail**, 119 expectations, 2 files (last run: 0.78 s) |
| `bun run --cwd prober build` | Pass; 3 static files in `public/dist/`, first-run wording |
| `python3 prober/check-workflow.py` | Pass; YAML parse plus trigger, job, permission, artifact, concurrency and SHA-shape checks; 4 pinned action references |
| `python3 prober/privacy-check.py` | Pass; **29 real identifiers**, **40 files**, zero fixed-string matches or non-attribution target URLs; both name directories available |
| `node prober/visual-check.mjs` | Pass; **63 browser assertions**, **16 implemented + 16 reference + 1 no-JS screenshots**, no browser errors |
| `git diff --check` | Pass |

Tests cover 3-failure/2-success confirmation, streak interruption at missing
slots, out-of-order/deduplicated observations, exact bytes including BOM/newline
mismatches, non-200 and redirect rejection, request and streamed-body deadlines,
32-byte body limit and sanitized network errors. Journal tests reconcile an
interrupted raw write using the original result even if a retry differs, retain
90 UTC raw dates, preserve 100 days of daily counts through repeated compaction,
and account for missing-day coverage. Delivery mocks cover repeated dispatch,
lost issue-create response, independent channels, failed durable claim, uncertain
ntfy response and interrupted send claim. The GitHub adapter rejects forged
markers from non-bot issues and sends fixed public wording only.

The HTTP end-to-end test starts/stops an ephemeral loopback Bun server, performs
**7 observations** (2 passing → 3 failing → 2 passing), persists/reloads the
journal, runs delivery twice per slot and builds first-run/reachable/unreachable/
unknown/recovering/unresolved-stale fixtures with a fake clock. Result: **1 issue
open, 1 close, 1 outage push, 1 recovery push**, 7 raw rows, 4 passed, 2 transitions.
A separate real-server test exercises redirects, timeout, wrong marker and a
chunked successful marker. The Actions-like log contains allowlisted observation
JSON and fixed messages, with no canary/topic URL or private names.

The local Playwright/axe run checked the four public scenarios at
390px/dark using WCAG 2 A/AA + 2.1 A/AA tags: **0 violations in each**. Results
are `prober/artifacts/visual/axe-{reachable,unreachable,unknown,first-run}.json`.
The initial axe run found the attribution link relied on color alone; adding a persistent underline fixed it. This is not a complete manual screen-reader or accessibility certification.

## Visual comparison

Chromium rendered the supplied mockup file with `view=public`, each scenario,
light/dark and 390/1280px. Reference screenshots remove only the surrounding
mockup controls, body margin and outer frame border; the Public view CSS/content
is preserved. Implemented screenshots use the real generated static HTML/CSS/JS,
system light/dark preference and a fixed browser clock. Browser checks also
verify 30/90 bars, zero horizontal overflow (including 320px), periodic expiry,
resumed-tab expiry, unresolved stale incident wording, first-success recovery
confirmation, clock skew and dated/no-current-green wording with JS disabled.

Artifacts (ignored local files, not shipped):

- `prober/artifacts/visual/{scenario}-{390,1280}-{light,dark}.png`
- `prober/artifacts/visual/reference-{scenario}-{390,1280}-{light,dark}.png`
- `prober/artifacts/visual/results.json` — assertions and measured rectangles
- `prober/artifacts/visual/no-js-390-light.png`
- `prober/artifacts/visual/comparison-{390,1280}.html` and `.png` — all eight
  scenario/theme pairs side by side, reference left / implementation right
- `prober/artifacts/e2e/actions-like.log` and `journal/` — captured local evidence

Here `{scenario}` is `reachable`, `unreachable`, `unknown` or `first-run`.

Observed differences from the mockup:

1. Same palette, system font, 26px verdict, icons, 720px desktop column, 390px
   phone column, 20/16px gutters, card positions and 34px daily bars. For both
   themes, the reachable/unknown/first-run card heights match the reference at
   both widths (to the measured subpixel). The unreachable card is **18.84px
   taller** because it includes the actual last-observation age and factual
   confirmation time rather than an invented owner activity statement.
2. UTC replaces mock CET; full observation date is retained in the dated HTML
   and observation tooltip. JS uses the date inline when it differs from today.
   Publication time remains separate from the observation.
3. History and incidents come from the seven real local test observations:
   older days have no data, the measured day contains failures, and only the
   one observed incident appears after recovery. The mockup has randomized green
   history, a sample 99.6% success / 98.9% coverage and two invented old incidents.
   These are intentionally not reproduced. Exact counts/denominators are exposed
   in expandable tables, adding a row below the legend and shifting Past incidents.
4. A small Gatus/Apache attribution footer is added. Production has no mockup
   toolbar, scenario selector, private navigation or manually switchable theme.

## Limits and owner work

Live Actions scheduling, the pinned action contents, Git checkpoint/rebase/push
behavior against GitHub, Pages/OIDC deployment, actual issue reconciliation and
email/ntfy/device receipt were **not exercised**; GitHub calls were prohibited.
Actionlint is unavailable; the offline YAML validator does not claim to resolve
remote action revisions or replace a live Actions run. No upstream Go/Vue
runtime behavior was changed or tested. No new runtime dependency or Bedrock
core concept was introduced.

Before enabling the workflow, complete [README.md](README.md#owner-setup-not-performed-by-this-implementation):
merge to default branch, expose/bypass-cache for the exact canary, set
`BEDROCK_CANARY_URL` and secret `NTFY_TOPIC_URL`, enable Issues and owner email
subscriptions, permit journal commits, select Pages source **GitHub Actions**,
enable Actions, dispatch once, then perform an owner-controlled outage/recovery
and delivery drill. Cloudflare Tunnel Health Alert remains optional/off.

ntfy dispatch is at-most-once per transition; ambiguous outcomes are retained as
`uncertain`, with possible lost pushes after a crash between claim and POST.
Issues are separately retryable. Git retains historical raw rows in commits even
after current-tree 90-day compaction. The schedule's intended cron due time is
not supplied by GitHub; slot identity uses original workflow creation time.
These limits are documented rather than presented as exactly-once delivery,
raw-data erasure, guaranteed five-minute sampling or validated external hosting.
