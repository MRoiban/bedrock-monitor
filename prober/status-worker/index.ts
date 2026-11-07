// Serves the GitHub Pages status page on the owner's apex domain from Cloudflare's edge,
// so it stays reachable when the home box (and its tunnel) is down.
interface Env { SOURCE_URL: string }
const PASS = ["content-type", "cache-control", "etag", "last-modified"];
const FILES: Record<string, string> = { "/": "./", "/index.html": "./", "/site.css": "./site.css", "/site.js": "./site.js" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    // Only the three exported files exist. Mapping a fixed allowlist (never the request path) keeps
    // the upstream origin fixed: a path like "/https://evil.example/x.js" must not choose it.
    const file = FILES[new URL(request.url).pathname];
    if (!file) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const source = new URL(env.SOURCE_URL);
    const upstream = await fetch(new URL(file, source), { method: request.method, redirect: "manual", cf: { cacheTtl: 60 } });
    if (upstream.status >= 300 && upstream.status < 400) return new Response("Bad gateway", { status: 502 });
    const headers = new Headers();
    for (const name of PASS) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    const response = new Response(upstream.body, { status: upstream.status, headers });
    if (!headers.get("content-type")?.startsWith("text/html")) return response;
    // The source zone injects a hidden crawler link back to itself; it is not part of the page.
    return new HTMLRewriter().on('a[href*="/cdn-cgi/content"]', { element: el => el.remove() }).transform(response);
  },
};
