# Bedrock Monitor

This fork retains TwiN/Gatus at `4b84fa2d591a364325b17d81ade755523508dc0b`
under Apache-2.0. Upstream Go, Vue, tests and build files are unchanged. The
independent `pebble/` directory is a Bun/React Bedrock application; **no Go
process runs**. Its check/result/hourly-summary/incident separation and compact
named status/history language adapt Gatus's data-model and card ideas. See
[NOTICE](NOTICE), the retained [LICENSE](LICENSE), and
[the pebble guide](pebble/README.md).

The private application requires the separately installed Bedrock daemon and UI
packages (`link:bedrock`, `link:@bedrock/ui`). It is creator-only. Credentials,
SQLite data, logs and private fixtures must never be committed. A separate
outside prober can supply the public Home cloud journal; no private data is
exported by this application.
