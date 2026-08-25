/**
 * TEBOW gateway — the small server that stands between the console and Claude.
 *
 * Why it exists: GitHub Pages hands out a file and nothing more, so anything
 * the console must keep secret (the API key) or keep private (the day's
 * schedule) cannot live there. This holds both, and only lets the owner in.
 *
 *   POST /ask       forwards a conversation to Claude using the key held here.
 *                   The key never reaches the browser.
 *   GET  /context   returns today's brief, so the console can answer
 *                   "what do I have this afternoon".
 *   PUT  /context   lets the scheduled morning run write that brief.
 *
 * /ask and GET /context require a Firebase sign-in from an allowed address.
 * PUT /context is used by the scheduled run, which cannot sign in, so it
 * carries a shared secret instead.
 */

const admin = require("firebase-admin");
admin.initializeApp();

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

/* Who may use this gateway. Anyone else is refused, signed in or not. */
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

/* Which pages may call it from a browser. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://jacef8.github.io")
  .split(",").map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  res.set("Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.set("Access-Control-Allow-Headers", "content-type,authorization,x-tebow-token");
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.set("Access-Control-Max-Age", "86400");
  res.set("Vary", "Origin");
}

/* Confirm the caller signed in, and that it is someone we allow. */
async function whoIsCalling(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { ok: false, why: "not signed in" };
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return { ok: false, why: "sign-in expired — reload the page" };
  }
  const email = (decoded.email || "").toLowerCase();
  if (!email) return { ok: false, why: "no email on this account" };
  if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) {
    return { ok: false, why: "this account is not allowed to use TEBOW" };
  }
  return { ok: true, email };
}

const db = () => admin.firestore().collection("tebow").doc("context");

exports.tebow = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const path = (req.path || "/").replace(/\/+$/, "") || "/";

  /* ── the day's brief ───────────────────────────────────────────── */
  if (path === "/context") {
    if (req.method === "PUT") {
      /* The scheduled run cannot sign in, so it carries a shared secret. */
      const token = req.headers["x-tebow-token"] || "";
      if (!process.env.WRITE_TOKEN || token !== process.env.WRITE_TOKEN) {
        res.status(403).json({ error: "not authorised" });
        return;
      }
      const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body || "");
      await db().set({ text: text.slice(0, 20000), updated: Date.now() });
      res.json({ ok: true, bytes: text.length });
      return;
    }
    if (req.method === "GET") {
      const who = await whoIsCalling(req);
      if (!who.ok) { res.status(401).json({ error: who.why }); return; }
      const snap = await db().get();
      res.json({ context: snap.exists ? (snap.data().text || "") : "" });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  /* ── ask Claude ────────────────────────────────────────────────── */
  if (path === "/ask" && req.method === "POST") {
    const who = await whoIsCalling(req);
    if (!who.ok) { res.status(401).json({ error: who.why }); return; }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "gateway has no API key configured" });
      return;
    }

    const payload = req.body || {};
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (!messages.length) { res.status(400).json({ error: "no messages" }); return; }

    /* Fold the day's brief into the system prompt, so the console can speak
       about the schedule without a public page ever holding it. */
    let brief = "";
    try {
      const snap = await db().get();
      if (snap.exists) brief = snap.data().text || "";
    } catch { /* a missing brief is not a reason to fail the question */ }

    const system = (payload.system || "") +
      (brief ? "\n\nToday's brief for the owner:\n" + brief : "");

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
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
      res.status(upstream.status).json({ error: "claude refused", detail });
      return;
    }

    /* Pass the stream through so replies still arrive word by word. */
    res.set("content-type", "text/event-stream");
    res.set("cache-control", "no-cache");
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    return;
  }

  if (path === "/" || path === "/health") {
    res.json({ ok: true, service: "tebow-gateway" });
    return;
  }
  res.status(404).json({ error: "not found" });
};
