// Kleiner Server: liefert die Website aus und leitet die KI-Funktionen an Claude weiter.
// Der API-Schlüssel bleibt so auf dem Server und landet nie im Browser.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MODEL = "claude-opus-5-5";
const MAX_BODY = 25 * 1024 * 1024; // Screenshots können groß sein

const client = new Anthropic();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- Claude-Aufruf mit strukturierter Antwort ----------

async function askClaude({ system, content, schema, effort = "medium" }) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("Die KI hat diese Anfrage abgelehnt.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Die Antwort war zu lang. Bitte kleinere Abschnitte verbessern.");
  }
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text);
}

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

const GLOSSARY_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      term: { type: "string" },
      explanation: { type: "string" },
    },
    required: ["term", "explanation"],
    additionalProperties: false,
  },
};

const IMPROVE_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, html: { type: "string" } },
        required: ["id", "html"],
        additionalProperties: false,
      },
    },
    glossary: GLOSSARY_SCHEMA,
  },
  required: ["blocks", "glossary"],
  additionalProperties: false,
};

const MODULE_ITEM = {
  type: "object",
  properties: {
    name: { type: "string" },
    examType: nullable({ type: "string" }),
    color: nullable({ type: "string" }),
  },
  required: ["name", "examType", "color"],
  additionalProperties: false,
};

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    addModules: { type: "array", items: MODULE_ITEM },
    updateModules: { type: "array", items: MODULE_ITEM },
    documentHtml: nullable({ type: "string" }),
    design: nullable({
      type: "object",
      properties: {
        pageColor: nullable({ type: "string" }),
        accentColor: nullable({ type: "string" }),
        headingColor: nullable({ type: "string" }),
        paper: nullable({ type: "string", enum: ["lined", "blank", "grid"] }),
      },
      required: ["pageColor", "accentColor", "headingColor", "paper"],
      additionalProperties: false,
    }),
    taskIdeas: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "addModules", "updateModules", "documentHtml", "design", "taskIdeas"],
  additionalProperties: false,
};

const HTML_RULES = `Erlaubtes HTML: <p>, <h1>, <h2>, <h3>, <ul>, <ol>, <li>, <b>, <i>, <u>, <br>, <span class="term">…</span> für Fachbegriffe, <span style="color:…;font-size:…">. Kein anderes Markup, keine Skripte.`;

const IMPROVE_SYSTEM = `Du bist der Korrektor eines Uni-Notizhefts. Du bekommst einzelne, frisch bearbeitete Absätze (Blöcke) einer Mitschrift.
Für jeden Block:
- Korrigiere Rechtschreibung, Grammatik und Zeichensetzung (Sprache des Blocks beibehalten, meist Deutsch).
- Formuliere unklare oder ungenaue Erklärungen präziser und fachlich korrekt, aber knapp. Erfinde keine neuen Inhalte und lass nichts weg.
- Behalte die Struktur bei: gleicher Blocktyp, Überschriften bleiben Überschriften, Listen bleiben Listen.
- Rot markierte Fachbegriffe (<span class="term">) bleiben exakt markiert; korrigiere nur ihre Schreibweise, falls falsch.
- Gib jeden Block mit derselben id zurück, auch wenn nichts zu ändern war.
${HTML_RULES}
Erstelle außerdem für jeden übergebenen Fachbegriff eine kurze, verständliche Erklärung (1–3 Sätze) im Kontext des Moduls.`;

const GLOSSARY_SYSTEM = `Du erklärst Fachbegriffe für ein Uni-Notizheft. Für jeden Begriff: eine kurze, verständliche und fachlich korrekte Erklärung (1–3 Sätze) im Kontext des genannten Moduls und der Notiz. Antworte in der Sprache der Notiz (meist Deutsch).`;

const CHAT_SYSTEMS = {
  timetable: `Du bist der Assistent eines Uni-Notizhefts im Bereich "Stundenplan & Module".
Wenn Screenshots eines Stundenplans kommen: Lies alle Module/Seminare/Vorlesungen heraus und gib sie in addModules zurück (Name ohne Uhrzeit/Raum, Dubletten zusammenfassen, Übungen/Tutorien zur passenden Vorlesung nur einmal). Module, die schon existieren, nicht erneut hinzufügen.
Wenn die Person sagt, welche Prüfungsform ein Modul hat (z. B. Klausur, Hausarbeit, Präsentation, Referat, mündliche Prüfung, Portfolio, unbenotet), gib das in updateModules zurück (examType). Farben nur setzen, wenn sie danach fragt (Hex-Farbe).
Antworte in reply kurz und freundlich auf Deutsch und fasse zusammen, was du erkannt oder geändert hast. Lass documentHtml und design null und taskIdeas leer.`,
  document: `Du bist der Assistent eines Uni-Notizhefts und hilfst bei der geöffneten Datei.
- Wenn die Person mit der Datei unzufrieden ist oder sie anders haben möchte (umstrukturieren, kürzen, ausführlicher, zusammenfassen, Fehler beheben …): gib die komplette neue Fassung in documentHtml zurück. Rot markierte Fachbegriffe (<span class="term">) beibehalten.
- Wenn sie ein Design/Aussehen möchte: gib design zurück (Hex-Farben für pageColor = Blatthintergrund, accentColor, headingColor; paper = lined/blank/grid). Nicht gesetzte Felder null. Halte Farben gut lesbar und dezent.
- Sonst documentHtml und design null lassen.
${HTML_RULES}
Antworte in reply kurz auf Deutsch und sag, was du geändert hast. addModules/updateModules/taskIdeas leer lassen.`,
  task: `Du bist der Aufgaben-Assistent eines Uni-Notizhefts. Die Person bearbeitet eine Seminaraufgabe.
Gib in taskIdeas 3–6 konkrete Ideen bzw. Lösungsansätze als kurze Stichpunkte. Wenn die Person ausdrücklich eine Lösung möchte, gib in documentHtml einen vollständigen, gut gegliederten Lösungsvorschlag (Überschrift + Stichpunkte/Absätze) zurück, sonst null.
${HTML_RULES}
reply: kurze Einordnung der Aufgabe auf Deutsch. addModules/updateModules leer, design null.`,
};

// ---------- API-Handler ----------

async function handleImprove(body) {
  const { moduleName = "", blocks = [], terms = [] } = body;
  if (!blocks.length && !terms.length) return { blocks: [], glossary: [] };
  const prompt = [
    `Modul: ${moduleName || "(ohne Modul)"}`,
    `Zu erklärende Fachbegriffe: ${terms.length ? terms.join(", ") : "(keine)"}`,
    "Bearbeitete Blöcke (JSON):",
    JSON.stringify(blocks),
  ].join("\n");
  return askClaude({ system: IMPROVE_SYSTEM, content: prompt, schema: IMPROVE_SCHEMA });
}

async function handleGlossary(body) {
  const { moduleName = "", terms = [], context = "" } = body;
  if (!terms.length) return { glossary: [] };
  const prompt = `Modul: ${moduleName || "(ohne Modul)"}\nBegriffe: ${terms.join(", ")}\nAuszug aus der Notiz:\n${context.slice(0, 6000)}`;
  const schema = {
    type: "object",
    properties: { glossary: GLOSSARY_SCHEMA },
    required: ["glossary"],
    additionalProperties: false,
  };
  return askClaude({ system: GLOSSARY_SYSTEM, content: prompt, schema, effort: "low" });
}

async function handleChat(body) {
  const { mode = "document", history = [], message = "", images = [], modules = [], documentHtml = "", moduleName = "" } = body;
  const system = CHAT_SYSTEMS[mode] || CHAT_SYSTEMS.document;
  const content = [];
  for (const img of images.slice(0, 10)) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(img);
    if (match) {
      content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
    }
  }
  const lines = [];
  if (modules.length) {
    lines.push("Vorhandene Module: " + modules.map((m) => `${m.name}${m.examType ? ` (${m.examType})` : ""}`).join("; "));
  }
  if (moduleName) lines.push(`Aktuelles Modul: ${moduleName}`);
  if (documentHtml) lines.push(`Aktuelle Datei (HTML):\n${documentHtml}`);
  if (history.length) {
    lines.push("Bisheriger Chat:\n" + history.slice(-12).map((h) => `${h.role === "user" ? "Ich" : "Assistent"}: ${h.text}`).join("\n"));
  }
  lines.push(`Neue Nachricht: ${message || (images.length ? "Bitte lies die Module aus diesen Stundenplan-Screenshots aus." : "")}`);
  content.push({ type: "text", text: lines.join("\n\n") });
  return askClaude({ system, content, schema: CHAT_SCHEMA, effort: mode === "task" ? "high" : "medium" });
}

const ROUTES = {
  "/api/improve": handleImprove,
  "/api/glossary": handleGlossary,
  "/api/chat": handleChat,
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

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": MIME[".json"] });
  res.end(JSON.stringify(data));
}

function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError || /authentication method/i.test(err.message)) return "Kein gültiger API-Schlüssel (ANTHROPIC_API_KEY) auf dem Server.";
  if (err instanceof Anthropic.RateLimitError) return "Zu viele Anfragen – bitte kurz warten.";
  if (err instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur KI.";
  if (err instanceof Anthropic.APIError) return `KI-Fehler: ${err.message}`;
  return err.message || "Unbekannter Fehler";
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

const server = http.createServer(async (req, res) => {
  const route = ROUTES[new URL(req.url, "http://x").pathname];
  if (!route) return serveStatic(req, res);
  if (req.method !== "POST") return sendJson(res, 405, { error: "Nur POST" });
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    sendJson(res, 200, await route(body));
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: errorMessage(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Notizheft läuft auf http://localhost:${PORT}`);
});
