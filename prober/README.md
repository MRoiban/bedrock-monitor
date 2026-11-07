# Independent Home cloud watcher

A Bun/TypeScript probe, public Git journal and static status export for the public
Bedrock monitoring fork. It runs on GitHub-hosted Ubuntu, independently of the
home box. No Go service, home pebble, private database or runtime npm dependency
is involved. The upstream Apache-2.0 licence is retained. The public layout and
Onyx-on-Flexoki tokens follow the Bedrock monitoring handoff; Gatus attribution
is visible on the page. All nine inherited upstream workflows are removed on
this branch: no upstream builds, Docker publishing, release or label jobs run.
The replacement workflow has only schedule and manual triggers; pushes do not
run it.

## Owner setup (not performed by this implementation)

1. Review and merge this branch into the fork's **default branch**. Before enabling
   Actions, check `.github/workflows/` contains only `bedrock-probe.yml`.
   Keep this repository public to use the public-repository standard-runner
   allowance. The inherited Gatus Go/Vue files remain upstream source, not the
   deployed monitoring service.
2. Make the canary publicly reachable at `https://bedrock.<domain>/healthz`.
   Configure a Cloudflare cache-bypass rule for `/healthz`; exclude it from Access
   login/redirect rules. Verify an unauthenticated GET returns exactly status 200
   and the bytes `bedrock-health-v1\n` (including the final newline). A 503 with
   `bedrock-unavailable-v1\n` is a failed observation. This tests gateway/daemon
   registry liveness, never application health.
3. Repository **Settings → Secrets and variables → Actions → Variables**: set
   `BEDROCK_CANARY_URL` to the full HTTPS canary URL. This is a repository variable,
   not a secret; its intentionally public hostname is disclosed to GitHub. Only
   a `bedrock.` hostname, `/healthz`, and no credentials/query/fragment are accepted.
4. In **Actions secrets**, set `NTFY_TOPIC_URL` to the full HTTPS ntfy topic URL
   used by the owner, for example `https://ntfy.sh/<unguessable-topic>`.
   Keep the topic secret: anyone who knows a public ntfy topic can read/publish.
   Subscribe the owner's phone to it before the first outage test. Do not put it
   in a variable, command argument, issue, journal or screenshot.
5. **Settings → Actions → General**: enable Actions on this fork and allow the
   four SHA-pinned actions in the workflow. Allow workflow read/write permissions.
   Default-branch protection must allow `github-actions[bot]` to commit `status/`
   (choose an appropriate branch rule; do not disable protection indiscriminately).
   The probe job requests only contents:write, issues:write and actions:read;
   actions:read retrieves the original run timestamp for stable rerun identity.
6. **Settings → Pages → Build and deployment → Source: GitHub Actions**. Allow
   deployments from the default branch in the `github-pages` environment. The
   deployment job alone has pages:write and id-token:write. The upload contains
   only `index.html`, `site.css`, `site.js`, not repository source or journal.
   No branch-based Pages build or extra deployment credential is needed.
7. Enable repository **Issues**, watch **All Activity** (or subscribe to the
   outage issues), and enable GitHub email notifications at the owner's verified
   email address. Issue creation is not proof an email arrived.
8. In **Actions → Bedrock outside probe → Run workflow**, run the default branch.
   Inspect `status/state.json`, `status/raw/YYYY-MM-DD.jsonl`, `status/daily.jsonl`
   and the Pages deployment. Verify the observation time and publication time
   separately. A second manual run in the same slot is deliberately a no-op.
9. Perform an owner-controlled outage drill: allow three consecutive failing
   slots, then two successful slots. Confirm one issue opens and closes, one
   ntfy outage/recovery push each, actual owner email receipt and a working Pages
   page while home is unreachable. Do not put diagnostic/private text into the
   public issue. One way: point `BEDROCK_CANARY_URL` at `https://bedrock.drill.invalid/healthz`
   and dispatch once per slot, then restore it; afterwards remove the drill rows from
   `status/` so the public history shows only real observations.
10. Optional, off by default: in Cloudflare Notifications/Zero Trust, create a
    **Tunnel Health Alert** for this tunnel to owner email. Test delivery. This
    complements the HTTP probe; connector health alone does not prove daemon
    health. No Cloudflare credential is used by this kit. A separate hosted
    missing-run watchdog is optional future owner setup, not configured here.

GitHub schedules can be delayed, dropped or disabled (including inactive public
repositories). `2-57/5 * * * *` is nominally every five minutes UTC, with no SLA.
Concurrency serializes the entire workflow and never cancels an active run;
GitHub may replace a pending run. Missing runs lower coverage, never create
successful samples. Freshness expires after 15 minutes even if Pages stops
publishing. Nominal outage confirmation is 10–15 minutes; recovery needs two
passing slots. Missing slots reset confirmation streaks but do not resolve an
already-open incident.

## Data, durability and notifications

`scheduled_at` is the UTC cadence slot ending at :02/:07/… containing the
**original workflow run's creation timestamp**, not the time a runner starts or a
rerun executes. GitHub's schedule event does not supply the intended cron due
time; do not interpret this field as proof a delayed run started on time. The
slot is the observation identity: retries/manual runs in the same slot do not
count twice. Older slots cannot overwrite newer state. No catch-up observations
are invented. `observed_at` is when the actual request starts. Duration uses a
monotonic clock. The GET disables redirects/cache, has a 10-second whole-exchange
deadline and a 32-byte response ceiling; status **and exact bytes** must match.
A failed HTTP status is recorded as `http_status`; transport/contract failures
use a fixed `error_class`. No response content, IP, headers, exception string or
target URL enters an observation.

- `status/raw/YYYY-MM-DD.jsonl`: one compact JSON line per observed slot, today
  and the preceding 89 UTC dates. Only the current daily file normally changes.
- `status/daily.jsonl`: `{date, expected, observed, passed}` forever, one UTC day
  per line. Expected counts include missing slots, including the unobserved
  portion before first setup. Today includes only elapsed scheduled slots.
  Success = passed/observed, coverage = observed/expected. A gap is not downtime
  and not success. Current-day page totals are as of publication.
- `status/state.json`: latest result, last-success time, confirmation counters,
  redacted incident times and issue numbers, transitions and delivery receipts.
  Open on three failures, recover on two successes; one success during an outage
  shows “confirming recovery”, never a recovered incident. No arbitrary owner
  prose is exported: incident updates are constructed from fixed public wording.

Raw retention is for the **current Git tree**. Public Git commits can retain old
raw observations forever; removing a file is not erasure from Git history or
third-party copies. Public outage timing is a permanent disclosure.

The workflow commits/pushes the observation and transition before notification.
Every delivery checkpoint also commits/pushes before proceeding. A failed page
build cannot discard the journal or suppress earlier notifications. A delivery
checkpoint failure is surfaced after artifact upload, while the separate Pages
job can still publish that artifact. Git push races are rebased onto the latest
default branch; conflicts fail without force-pushing. Rerun after fixing a branch
rule/conflict. No on-box service participates.

Issues carry a stable hidden incident marker. Each retry first lists bot-created
issues (including closed ones), reconciling a successful create whose response
was lost. Recovery PATCHes the same issue closed; repeating the PATCH is safe.
GitHub API failures leave issue delivery `pending` for a later run.

ntfy has no server-side idempotency transaction with Git. Before POST, the kit
**durably claims** that transition; reruns never resend claimed/sent/uncertain
pushes. A crash between claim and POST can therefore lose that push, and a lost
response cannot be distinguished from accepted delivery. Such outcomes become
`uncertain`, not “delivered”; the issue path remains independently retryable.
This is at-most-once dispatch, not an exactly-once delivery promise. Inspect the
state and verify the owner's device; only an owner deliberately resetting an
uncertain transition to `pending` can authorize a possibly duplicate resend.
Neither HTTP acceptance nor a completed issue operation proves email/phone
receipt. Fixed log messages never print the topic, request errors or API bodies.

## Public boundary and page behavior

The repository/journal/issues disclose only “Home cloud”, observation slots and
outcomes, durations, redacted incident times, issue numbers and delivery states.
The configured canary hostname is intentionally public but omitted from the page
and journal. No individual application names, private URLs, counts, logs,
headers, IPs, response bodies, diagnostic messages or ntfy topic are exported.
The public DTO is explicitly constructed, not a private object with hidden fields.
GitHub itself sees the canary variable and topic secret. Actions logs include
allowlisted observations and fixed operational messages only.

Pages uses system light/dark preference and the mockup's 720px public column,
semantic symbols, tokens and daily state bars. It shows 30 days below 600px and
90 on larger screens, with aggregate coverage plus expandable exact daily counts.
A dated no-JS headline never asserts current health. JavaScript validates age on
load, every 30 seconds while visible, and on visibility/pageshow after suspension.
After 15 minutes it says “Current status unknown”; an unresolved incident remains
explicitly unresolved. A clock behind publication/observation cannot produce a
green assertion. A fast clock expires conservatively; an undetectably wrong
clock cannot be corrected without a trusted external time source. Publication
never freshens an observation. The page fetches no home URL and no live JSON.

## Local verification

From the repository root (Bun ≥1.2; implementation verified on 1.4.3):

```sh
bun install --cwd prober
bun run --cwd prober typecheck
bun test prober
bun run --cwd prober build
python3 prober/check-workflow.py --remote
# Playwright and axe resolve from PLAYWRIGHT_MODULE/AXE_MODULE (default: node_modules);
# MONITOR_MOCKUP is the Bedrock repo's design/monitoring/mockup.html.
MONITOR_MOCKUP=../bedrock/design/monitoring/mockup.html node prober/visual-check.mjs
python3 prober/privacy-check.py
```

No runtime dependencies; TypeScript and Bun types are dev-only. YAML validation
uses locally available PyYAML; it checks structure/permissions/pins, without
resolving action SHAs or running Actions. The browser script uses the supplied
Playwright installation and its cached Chromium without downloading anything;
override `PLAYWRIGHT_MODULE`/`AXE_MODULE`/`MONITOR_MOCKUP` for a different local checkout.
No GitHub/ntfy calls occur in these checks: delivery is mocked. All test servers
bind loopback and stop afterwards. Test journals, fake-clock pages, captured
Actions-like log, screenshots and comparison metadata go under ignored
`prober/artifacts/`; the actual empty production journal remains empty.
`public/dist/` is the ignored first-run build ready for Pages. Do not deploy test
fixtures. No test reads/writes another application's data; the privacy check
only lists names in the two explicitly requested directories.

See [VERIFICATION.md](VERIFICATION.md) for measured results and visual differences.
