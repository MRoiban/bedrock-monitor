# Status page on the owner's domain

A Cloudflare Worker that serves the GitHub Pages export at the apex domain from Cloudflare's
edge, so the page stays up when the home box and its tunnel are down. Query strings are
dropped; only GET/HEAD of `/`, `/index.html`, `/site.css` and `/site.js` are served (everything else 404,
upstream redirects 502), so the upstream origin is fixed; upstream is cached for 60 s.

```sh
# SOURCE_URL in wrangler.toml is the Pages URL; routes is the domain to serve.
bunx wrangler deploy
```

A Workers custom domain needs the hostname free of other A/AAAA/CNAME records; remove a
placeholder record first (redirect rules on the same hostname keep working, they run
before Workers).
