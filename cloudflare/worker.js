/**
 * TEBOW gateway — the small program that stands between the console and Claude.
 *
 * Why it exists: GitHub Pages hands out a file and nothing more, so anything
 * the console needs to keep secret (an API key) or keep private (a schedule)
 * cannot live there. This does both:
 *
 *   POST /ask       forwards a conversation to Claude using the key stored
 *                   here as a secret. The key never reaches the browser.
 *   GET  /context   returns today's brief, so the console can answer
 *                   "what do I have this afternoon".
 *   PUT  /context   lets the scheduled morning run write that brief.
 *
 * Everything except /context PUT sits behind Cloudflare Access, so only
 * approved email addresses reach it at all.
 */

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

/* Only these origins may call the gateway from a browser. */
const ALLOWED_ORIGINS = [
  "https://jacef8.github.io",
];

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    /* ── today's brief ─────────────────────────────────────────────── */
    if (url.pathname === "/context") {
      if (request.method === "GET") {
        const stored = await env.TEBOW.get("context");
        return json({ context: stored || "" }, 200, origin);
      }
      if (request.method === "PUT") {
        /* Written by the scheduled morning run, which cannot sign in
           through Access, so it carries a shared secret instead. */
        const token = request.headers.get("x-tebow-token") || "";
        if (!env.WRITE_TOKEN || token !== env.WRITE_TOKEN) {
          return json({ error: "not authorised" }, 403, origin);
        }
        const body = await request.text();
        await env.TEBOW.put("context", body.slice(0, 20000));
        return json({ ok: true, bytes: body.length }, 200, origin);
      }
      return json({ error: "method not allowed" }, 405, origin);
    }

    /* ── ask Claude ────────────────────────────────────────────────── */
    if (url.pathname === "/ask" && request.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return json({ error: "gateway has no API key configured" }, 500, origin);
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400, origin);
      }

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (!messages.length) {
        return json({ error: "no messages" }, 400, origin);
      }

      /* Fold today's brief into the system prompt so the console can
         answer questions about the day without ever holding the data. */
      const brief = (await env.TEBOW.get("context")) || "";
      const system = [
        payload.system || "",
        brief ? "\n\nToday's brief for the owner:\n" + brief : "",
      ].join("");

      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model || MODEL,
          max_tokens: payload.max_tokens || MAX_TOKENS,
          stream: true,
          system,
          messages,
        }),
      });

      if (!upstream.ok) {
        const detail = await upstream.text();
        return json({ error: "claude refused", status: upstream.status, detail }, upstream.status, origin);
      }

      /* Hand the stream straight through so replies still arrive word by word. */
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          ...cors(origin),
        },
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "tebow-gateway" }, 200, origin);
    }

    return json({ error: "not found" }, 404, origin);
  },
};
