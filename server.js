// Kleiner Server: liefert die Website aus und schützt sie optional mit einem Passwort.
// Alle Funktionen der Seite sind kostenlos – es gibt keine kostenpflichtigen Dienste.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 64 * 1024; // nur das Login-Formular

const APP_PASSWORD = process.env.APP_PASSWORD || "";
const AUTH_COOKIE = "nh_auth";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- HTTP ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Anfrage zu groß"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Nicht gefunden");
  }
}

// ---------- Passwortschutz (aktiv, sobald APP_PASSWORD gesetzt ist) ----------

const authToken = () => crypto.createHash("sha256").update(`notizheft:${APP_PASSWORD}`).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isLoggedIn(req) {
  if (!APP_PASSWORD) return true;
  const cookies = Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k)
  );
  return safeEqual(cookies[AUTH_COOKIE] || "", authToken());
}

function loginPage(error = "") {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Notizheft</title><link rel="icon" href="data:,">
<style>
  :root { --bg:#f2f2f7; --panel:#fff; --text:#1c1c1e; --muted:#8e8e93; --border:#d9d9de; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1c1c1e; --panel:#2c2c2e; --text:#f2f2f7; --border:#3a3a3c; } }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box;
    background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif; }
  form { background:var(--panel); border-radius:16px; padding:28px; width:340px; max-width:100%; box-shadow:0 8px 30px rgba(0,0,0,.12); }
  h1 { margin:0 0 4px; font-size:22px; } h1::before { content:"● "; color:#ff9f0a; }
  p { margin:0 0 18px; color:var(--muted); font-size:14px; }
  input { width:100%; box-sizing:border-box; font-size:17px; padding:11px 12px; border:1px solid var(--border); border-radius:10px; background:var(--panel); color:var(--text); }
  button { margin-top:12px; width:100%; font-size:17px; font-weight:600; padding:11px; border:0; border-radius:10px; background:#ff9f0a; color:#fff; }
  .err { color:#ff3b30; margin:10px 0 0; font-size:14px; }
</style></head><body>
<form method="post" action="/login">
  <h1>Notizheft</h1><p>Bitte Passwort eingeben.</p>
  <input type="password" name="password" autocomplete="current-password" autofocus required>
  ${error ? `<div class="err">${error}</div>` : ""}
  <button type="submit">Öffnen</button>
</form></body></html>`;
}

async function handleLogin(req, res) {
  const password = new URLSearchParams(await readBody(req)).get("password") || "";
  if (!safeEqual(password, APP_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800)); // bremst Ausprobieren
    res.writeHead(401, { "Content-Type": MIME[".html"] });
    return res.end(loginPage("Falsches Passwort."));
  }
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.writeHead(303, {
    Location: "/",
    "Set-Cookie": `${AUTH_COOKIE}=${authToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
  });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  if (APP_PASSWORD && pathname === "/login" && req.method === "POST") return handleLogin(req, res);
  if (!isLoggedIn(req)) {
    res.writeHead(401, { "Content-Type": MIME[".html"] });
    return res.end(loginPage());
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Notizheft läuft auf http://localhost:${PORT}`);
});
