// Serves the GitHub Pages status page on the owner's apex domain from Cloudflare's edge,
// so it stays reachable when the home box (and its tunnel) is down.
interface Env { SOURCE_URL: string }
const PASS = ["content-type", "cache-control", "etag", "last-modified"];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    const url = new URL(request.url);
    // Only the static export exists upstream; drop the query so it cannot vary or bust the cache.
    const path = url.pathname.replace(/^\/+/, "");
    if (path.split("/").includes("..")) return new Response("Not found", { status: 404 });
    const upstream = await fetch(new URL(path, env.SOURCE_URL), { method: request.method, redirect: "follow", cf: { cacheTtl: 60 } });
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
