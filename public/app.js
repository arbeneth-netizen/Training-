// Notizheft – Uni-Notizen im Pages-Stil, optimiert fürs Schreiben mit der Tastatur.
// Alle Daten liegen lokal im Browser (IndexedDB). Alles ist kostenlos: Rechtschreibung über LanguageTool, Texterkennung über Tesseract.

// ============================================================
// Hilfsfunktionen
// ============================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Strg";
const HEAD_MOD = isMac ? "⌘+⌥" : "Strg+Shift";

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const fmtShort = (ts) => new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtLong = (ts) => new Date(ts).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const fmtRelative = (ts) =>
  sameDay(ts, Date.now())
    ? "Heute, " + new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : fmtShort(ts);

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function toast(text, type = "", ms = 2600) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = text;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const safeFileName = (s) => (s || "Notiz").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "Notiz";

// ============================================================
// Konstanten
// ============================================================

// Nur Schriftarten, die an der Uni üblich sind
const FONTS = {
  Arial: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  Calibri: 'Calibri, Carlito, "Segoe UI", Helvetica, sans-serif',
  Cambria: 'Cambria, Caladea, Georgia, serif',
  Garamond: 'Garamond, "EB Garamond", "Times New Roman", serif',
  Georgia: "Georgia, serif",
  Helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  Palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  "Times New Roman": '"Times New Roman", "Liberation Serif", Times, serif',
  Verdana: "Verdana, Geneva, sans-serif",
};

const KINDS = {
  quick: { label: "Schnellnotiz", ico: "⚡", desc: "Kurz etwas festhalten", key: "1" },
  notes: { label: "Mitschrift", ico: "📝", desc: "Vorlesung / Seminar mitschreiben", key: "2" },
  task: { label: "Aufgabe", ico: "✏️", desc: "Seminaraufgabe bearbeiten", key: "3" },
  block: { label: "Collegeblock", ico: "📒", desc: "Freies Notieren – wird nie verarbeitet", key: "4" },
};

const PAPERS = { lined: "Liniert", blank: "Normal", grid: "Kariert" };

const MODULE_COLORS = ["#ff9f0a", "#0a84ff", "#30d158", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a", "#ac8e68", "#5e5ce6", "#ff6b35"];
const TEXT_COLORS = [
  ["#1c1c1e", "Schwarz"],
  ["#0a5bd3", "Blau"],
  ["#1f8a3b", "Grün"],
];
const PEN_COLORS = ["#1c1c1e", "#0a5bd3", "#e0201b", "#1f8a3b"];
// Stiftarten – alle mit Farben
const PEN_TOOLS = [
  ["ballpoint", "🖊 Kugelschreiber", 3],
  ["fountain", "✒️ Füller", 4],
  ["pencil", "✏️ Bleistift", 3],
  ["crayon", "🖍 Buntstift", 5],
];
const MARKER_COLORS = ["rgba(255,214,10,0.45)", "rgba(52,199,89,0.35)", "rgba(255,105,180,0.35)", "rgba(100,210,255,0.4)"];
const EXAM_TYPES = ["Klausur", "Hausarbeit", "Präsentation", "Referat", "Mündliche Prüfung", "Portfolio", "Essay", "Protokoll", "Studienleistung", "Unbenotet"];
const SHEET_BASE_WIDTH = 794; // A4 bei 96 dpi

// ============================================================
// Speicher (IndexedDB, Fallback localStorage)
// ============================================================

const DB_NAME = "notizheft";
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      if (!req.result.objectStoreNames.contains("blobs")) req.result.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Originaldateien (Anhänge) liegen getrennt, damit der Zustand klein bleibt
async function blobStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", mode);
    const req = fn(tx.objectStore("blobs"));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const putBlob = (id, blob) => blobStore("readwrite", (st) => st.put(blob, id));
const getBlob = (id) => blobStore("readonly", (st) => st.get(id));
const delBlob = (id) => blobStore("readwrite", (st) => st.delete(id));

async function loadState() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get("state");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const raw = localStorage.getItem(DB_NAME);
    return raw ? JSON.parse(raw) : null;
  }
}

async function writeState() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, "state");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(DB_NAME, JSON.stringify(state));
    } catch {
      toast("Speichern fehlgeschlagen – Speicher voll?", "error");
    }
  }
}

const persist = debounce(writeState, 400);

// ============================================================
// Zustand
// ============================================================

function semesterName(date) {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  if (m >= 10) return `WiSe ${y}/${y + 1}`;
  if (m <= 3) return `WiSe ${y - 1}/${y}`;
  return `SoSe ${y}`;
}

function nextSemesterName(name) {
  const wi = /WiSe (\d{4})\/(\d{4})/.exec(name);
  if (wi) return `SoSe ${wi[2]}`;
  const so = /SoSe (\d{4})/.exec(name);
  if (so) return `WiSe ${so[1]}/${Number(so[1]) + 1}`;
  return semesterName(new Date());
}

function defaultState() {
  const sem = { id: uid(), name: semesterName(new Date()), timetable: { images: [] } };
  return {
    version: 1,
    settings: { font: "Arial", fontSize: 12, paper: "lined" },
    semesters: [sem],
    currentSemesterId: sem.id,
    modules: [],
    folders: [],
    docs: [],
    files: [],
  };
}

let state;

const ui = {
  view: "files", // files | recent | timetable | editor
  loc: { moduleId: undefined, folderId: null }, // moduleId undefined = Wurzel, null = Sonstiges
  docId: null,
  tool: "text",
  pen: { kind: "pen", tool: "ballpoint", color: PEN_COLORS[0], width: 3, eraseMode: "stroke", autoShape: localStorage.getItem("nh-autoshape") !== "0" },
  panel: null, // task | design
  sort: localStorage.getItem("nh-sort") || "updated",
  layout: localStorage.getItem("nh-layout") || "grid",
  search: "",
  pendingFontSize: null,
};

const currentSemester = () => state.semesters.find((s) => s.id === state.currentSemesterId) || state.semesters[0];
const semModules = () => state.modules.filter((m) => m.semesterId === state.currentSemesterId).sort((a, b) => a.name.localeCompare(b.name, "de"));
const semDocs = () => state.docs.filter((d) => d.semesterId === state.currentSemesterId);
const moduleById = (id) => state.modules.find((m) => m.id === id);
const docById = (id) => state.docs.find((d) => d.id === id);
const moduleName = (id) => (id ? moduleById(id)?.name || "Modul" : "Sonstiges");
const moduleColor = (id) => (id ? moduleById(id)?.color || "#8e8e93" : "#8e8e93");

function sortDocs(docs) {
  const by = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    name: (a, b) => (a.title || "").localeCompare(b.title || "", "de", { numeric: true }),
    kind: (a, b) => a.kind.localeCompare(b.kind) || b.updatedAt - a.updatedAt,
  }[ui.sort];
  return [...docs].sort(by);
}

function addModule(name, extra = {}) {
  const used = semModules().length;
  const mod = {
    id: uid(),
    semesterId: state.currentSemesterId,
    name: name.trim(),
    color: extra.color || MODULE_COLORS[used % MODULE_COLORS.length],
    examType: extra.examType || "",
    createdAt: Date.now(),
  };
  state.modules.push(mod);
  persist();
  return mod;
}

function createDoc({ moduleId = null, folderId = null, kind = "notes", paper, title }) {
  const now = Date.now();
  const doc = {
    id: uid(),
    semesterId: state.currentSemesterId,
    moduleId,
    folderId,
    kind,
    paper: paper || state.settings.paper,
    mode: { quick: "normal", block: "normal", task: "task" }[kind] || "notes",
    title: title || `${KINDS[kind].label} ${fmtShort(now)}`,
    heading: moduleId ? moduleName(moduleId) : "",
    font: state.settings.font,
    html: "",
    floats: "",
    strokes: [],
    glossary: {},
    improved: {},
    declinedSig: "",
    design: {},
    task: "",
    createdAt: now,
    updatedAt: now,
  };
  state.docs.push(doc);
  persist();
  return doc;
}

// ============================================================
// HTML säubern (für Import und Einfügen)
// ============================================================

const ALLOWED_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "S", "SUP", "SUB", "BR", "SPAN", "HR", "IMG", "TABLE", "TBODY", "THEAD", "TR", "TD", "TH"]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "SVG", "VIDEO", "AUDIO", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);
const KEEP_CLASSES = ["term", "box", "img-box", "locked", "checklist", "page-break", "tbl"];
const KEEP_DATA = ["bid", "toc", "x", "y", "w", "checked"];

function cleanNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    if (DROP_TAGS.has(child.tagName) || (child.tagName === "IMG" && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(child.getAttribute("src") || ""))) {
      child.remove();
      continue;
    }
    cleanNode(child);
    if (child.tagName === "STRIKE" || child.tagName === "DEL") {
      const sEl = document.createElement("s");
      sEl.append(...child.childNodes);
      child.replaceWith(sEl);
      continue;
    }
    if (!ALLOWED_TAGS.has(child.tagName)) {
      const tag = child.tagName;
      const isBlock = /^(H[4-6]|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE)$/.test(tag);
      if (isBlock) {
        const p = document.createElement(/^H[4-6]$/.test(tag) ? "h3" : "p");
        p.append(...child.childNodes);
        child.replaceWith(p);
      } else {
        child.replaceWith(...child.childNodes);
      }
      continue;
    }
    const st = child.style || {};
    const keep = {
      color: st.color,
      "font-size": /^\d+(\.\d+)?(pt|px)$/.test(st.fontSize || "") ? st.fontSize : "",
      "background-color": st.backgroundColor,
      "text-align": /^(left|center|right|justify)$/.test(st.textAlign || "") ? st.textAlign : "",
      "padding-left": /^\d+px$/.test(st.paddingLeft || "") ? st.paddingLeft : "",
      width: child.tagName === "IMG" && /^\d+(\.\d+)?%$/.test(st.width || "") ? st.width : "",
    };
    const classes = KEEP_CLASSES.filter((c) => child.classList?.contains(c));
    const data = KEEP_DATA.map((k) => [k, child.getAttribute("data-" + k)]).filter(([, v]) => v !== null);
    const src = child.tagName === "IMG" ? child.getAttribute("src") : null;
    for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    if (classes.length) child.className = classes.join(" ");
    for (const [k, v] of Object.entries(keep)) if (v) child.style.setProperty(k, v);
    for (const [k, v] of data) child.setAttribute("data-" + k, v);
    if (src) {
      child.setAttribute("src", src);
      child.setAttribute("alt", "");
    }
  }
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

// ============================================================
// App-Rahmen: Semester, Seitenleiste
// ============================================================

function renderSemesterSelect() {
  const sel = $("#semesterSelect");
  const sems = [...state.semesters].sort((a, b) => b.name.localeCompare(a.name, "de"));
  sel.innerHTML =
    sems.map((s) => `<option value="${s.id}" ${s.id === state.currentSemesterId ? "selected" : ""}>${esc(s.name)}</option>`).join("") +
    `<option value="__new">＋ Neues Semester …</option>`;
}

async function switchSemester(id) {
  if (ui.view === "editor") await leaveEditor();
  state.currentSemesterId = id;
  ui.loc = { moduleId: undefined, folderId: null };
  ui.view = "files";
  persist();
  renderAll();
  toast(`Semester: ${currentSemester().name}`);
}

async function newSemester() {
  const suggestion = nextSemesterName(currentSemester().name);
  const name = await promptModal("Neues Semester", "Name, z. B. WiSe 2027/2028", suggestion);
  if (!name) return renderSemesterSelect();
  const existing = state.semesters.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (existing) return switchSemester(existing.id);
  const sem = { id: uid(), name, timetable: { images: [] } };
  state.semesters.push(sem);
  await switchSemester(sem.id);
}

function renderSidebar() {
  const mods = semModules();
  const docs = semDocs();
  const count = (id) => docs.filter((d) => d.moduleId === id).length;
  const active = (cond) => (cond ? "active" : "");
  const sb = $("#sidebar");
  sb.innerHTML = `
    <div class="side-section">
      <div class="side-title">Bibliothek</div>
      <button class="side-item ${active(ui.view === "files" && ui.loc.moduleId === undefined)}" data-nav="root"><span class="ico">🗂</span><span class="name">Alle Dateien</span></button>
      <button class="side-item ${active(ui.view === "recent")}" data-nav="recent"><span class="ico">🕘</span><span class="name">Zuletzt</span></button>
      <button class="side-item ${active(ui.view === "timetable")}" data-nav="timetable"><span class="ico">📅</span><span class="name">Stundenplan &amp; Module</span></button>
    </div>
    <div class="side-section">
      <div class="side-title">Module <button data-nav="add-module" title="Modul hinzufügen">＋</button></div>
      ${mods.length ? "" : `<div class="side-empty">Noch keine Module. Lade deinen Stundenplan hoch oder tippe auf ＋.</div>`}
      ${mods
        .map(
          (m) => `
        <div class="side-item ${active(ui.view === "files" && ui.loc.moduleId === m.id)}" data-module="${m.id}" role="button" tabindex="0" title="${esc(m.name)} – neues Blatt">
          <label class="color-dot" style="background:${esc(m.color)}" title="Farbe ändern"><input type="color" value="${esc(m.color)}" data-color="${m.id}"></label>
          <span class="name">${esc(m.name)}</span>
          <span class="meta">${m.examType ? esc(m.examType) : count(m.id) || ""}</span>
          <button class="open-files" data-files="${m.id}" title="Dateien ansehen">📁</button>
        </div>`
        )
        .join("")}
      <div class="side-item ${active(ui.view === "files" && ui.loc.moduleId === null)}" data-module="" role="button" tabindex="0" title="Für alles andere">
        <span class="color-dot" style="background:#8e8e93"></span>
        <span class="name">Sonstiges</span>
        <span class="meta">${count(null) || ""}</span>
        <button class="open-files" data-files="" title="Dateien ansehen">📁</button>
      </div>
    </div>`;

  sb.querySelectorAll("[data-nav]").forEach((b) =>
    b.addEventListener("click", async () => {
      const nav = b.dataset.nav;
      if (nav === "add-module") return addModuleDialog();
      if (ui.view === "editor") await leaveEditor();
      if (nav === "root") {
        ui.view = "files";
        ui.loc = { moduleId: undefined, folderId: null };
      } else ui.view = nav;
      closeMobileSidebar();
      renderAll();
    })
  );
  sb.querySelectorAll("[data-module]").forEach((el) => {
    const id = el.dataset.module || null;
    const open = (e) => {
      if (e.target.closest(".color-dot, .open-files")) return;
      closeMobileSidebar();
      newSheetDialog({ moduleId: id });
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => e.key === "Enter" && open(e));
  });
  sb.querySelectorAll("[data-files]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (ui.view === "editor") await leaveEditor();
      ui.view = "files";
      ui.loc = { moduleId: b.dataset.files || null, folderId: null };
      closeMobileSidebar();
      renderAll();
    })
  );
  sb.querySelectorAll("[data-color]").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("input", () => {
      const m = moduleById(inp.dataset.color);
      m.color = inp.value;
      inp.parentElement.style.background = inp.value;
      persist();
    });
    inp.addEventListener("change", () => renderAll());
  });
}

function closeMobileSidebar() {
  $("#sidebar").classList.remove("open");
}

async function addModuleDialog() {
  const name = await promptModal("Neues Modul", "Name des Moduls / Seminars", "");
  if (!name) return;
  addModule(name);
  renderAll();
}

function renderAll() {
  renderSemesterSelect();
  renderSidebar();
  renderMain();
}

function renderMain() {
  const main = $("#main");
  main.onpaste = null;
  if (ui.view === "editor" && docById(ui.docId)) return renderEditor(main);
  if (ui.view === "timetable") return renderTimetable(main);
  if (ui.view === "recent") return renderFiles(main, true);
  ui.view = "files";
  renderFiles(main, false);
}

// ============================================================
// Modals
// ============================================================

let modalClose = null;

function openModal(html, { wide = false } = {}) {
  const bd = $("#modalBackdrop");
  bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? "width:640px" : ""}">${html}</div>`;
  bd.hidden = false;
  const modal = $(".modal", bd);
  return new Promise((resolve) => {
    modalClose = (value) => {
      bd.hidden = true;
      bd.innerHTML = "";
      modalClose = null;
      resolve(value);
    };
    bd.onclick = (e) => {
      if (e.target === bd) modalClose(null);
    };
    modal.close = modalClose;
    (modal.querySelector("[autofocus]") || modal.querySelector("input, button"))?.focus();
    modal.dispatchEvent(new CustomEvent("mount"));
    openModal.lastModal = modal;
  });
}

function promptModal(title, label, value = "") {
  const p = openModal(`
    <h3>${esc(title)}</h3>
    <label class="field"><span>${esc(label)}</span><input class="input" id="pmInput" value="${esc(value)}" autofocus></label>
    <div class="modal-actions"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>OK</button></div>`);
  const m = openModal.lastModal;
  const ok = () => m.close($("#pmInput", m).value.trim() || null);
  $("[data-ok]", m).onclick = ok;
  $("[data-x]", m).onclick = () => m.close(null);
  $("#pmInput", m).addEventListener("keydown", (e) => e.key === "Enter" && ok());
  setTimeout(() => $("#pmInput", m)?.select(), 40);
  return p;
}

function confirmModal(title, text, okLabel = "OK", { danger = false, cancelLabel = "Abbrechen" } = {}) {
  const p = openModal(`
    <h3>${esc(title)}</h3><p class="lead">${esc(text)}</p>
    <div class="modal-actions"><button class="btn" data-x>${esc(cancelLabel)}</button><button class="btn ${danger ? "danger" : "primary"}" data-ok autofocus>${esc(okLabel)}</button></div>`);
  const m = openModal.lastModal;
  $("[data-ok]", m).onclick = () => m.close(true);
  $("[data-x]", m).onclick = () => m.close(false);
  return p.then((v) => !!v);
}

function folderOptions(moduleId, selectedId) {
  const folders = state.folders.filter((f) => f.semesterId === state.currentSemesterId && f.moduleId === moduleId);
  const build = (parentId, depth) =>
    folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .map(
        (f) =>
          `<option value="${f.id}" ${f.id === selectedId ? "selected" : ""}>${"  ".repeat(depth)}📁 ${esc(f.name)}</option>` + build(f.id, depth + 1)
      )
      .join("");
  return `<option value="">(Hauptebene)</option>` + build(null, 0);
}

// Auswahl nach Klick auf ein Modul: Schnellnotiz, Mitschrift, Aufgabe oder Collegeblock
function newSheetDialog({ moduleId = null, folderId = null, kind = "notes" } = {}) {
  let chosen = kind;
  let paper = state.settings.paper;
  const p = openModal(`
    <h3>Neues Blatt · <span style="color:${esc(moduleColor(moduleId))}">${esc(moduleName(moduleId))}</span></h3>
    <p class="lead">Was möchtest du schreiben?</p>
    <div class="kind-grid">
      ${Object.entries(KINDS)
        .map(
          ([k, v]) => `<button class="kind-card ${k === chosen ? "on" : ""}" data-kind="${k}">
            <span><span class="k-ico">${v.ico}</span><span class="key">${v.key}</span></span><b>${v.label}</b><small>${v.desc}</small></button>`
        )
        .join("")}
    </div>
    <div class="field"><span>Blatt</span>
      <div class="seg" id="paperSeg">${Object.entries(PAPERS)
        .map(([k, v]) => `<button data-paper="${k}" class="${k === paper ? "on" : ""}">${v}</button>`)
        .join("")}</div>
    </div>
    <label class="field"><span>Titel</span><input class="input" id="nsTitle" placeholder="${esc(KINDS[chosen].label)} ${fmtShort(Date.now())}"></label>
    <label class="field"><span>Ordner</span><select class="input" id="nsFolder">${folderOptions(moduleId, folderId)}</select></label>
    <div class="modal-actions">
      <button class="btn left" data-files>📁 Dateien ansehen</button>
      <button class="btn" data-x>Abbrechen</button>
      <button class="btn primary" data-ok>Erstellen ↵</button>
    </div>`);
  const m = openModal.lastModal;
  const titleInput = $("#nsTitle", m);
  const setKind = (k) => {
    chosen = k;
    $$(".kind-card", m).forEach((c) => c.classList.toggle("on", c.dataset.kind === k));
    titleInput.placeholder = `${KINDS[k].label} ${fmtShort(Date.now())}`;
  };
  $$(".kind-card", m).forEach((c) => (c.onclick = () => setKind(c.dataset.kind)));
  $$("#paperSeg button", m).forEach(
    (b) =>
      (b.onclick = () => {
        paper = b.dataset.paper;
        $$("#paperSeg button", m).forEach((x) => x.classList.toggle("on", x === b));
      })
  );
  const create = () => {
    const doc = createDoc({ moduleId, folderId: $("#nsFolder", m).value || null, kind: chosen, paper, title: titleInput.value.trim() });
    m.close(doc);
  };
  $("[data-ok]", m).onclick = create;
  $("[data-x]", m).onclick = () => m.close(null);
  $("[data-files]", m).onclick = async () => {
    m.close(null);
    if (ui.view === "editor") await leaveEditor();
    ui.view = "files";
    ui.loc = { moduleId, folderId: null };
    renderAll();
  };
  m.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.target.matches("select")) {
      e.preventDefault();
      create();
    } else if (e.target !== titleInput) {
      const k = Object.keys(KINDS).find((key) => KINDS[key].key === e.key);
      if (k) setKind(k);
    }
  });
  titleInput.focus();
  return p.then(async (doc) => {
    if (!doc) return;
    if (ui.view === "editor") await leaveEditor();
    openDoc(doc.id);
  });
}

async function newFolderDialog(moduleId, parentId) {
  const name = await promptModal("Neuer Ordner", "Name des Ordners", "");
  if (!name) return;
  state.folders.push({ id: uid(), semesterId: state.currentSemesterId, moduleId, parentId: parentId || null, name, createdAt: Date.now() });
  persist();
  renderAll();
}

function plusMenu() {
  const moduleId = ui.loc.moduleId === undefined ? null : ui.loc.moduleId;
  const atRoot = ui.view !== "files" || ui.loc.moduleId === undefined;
  const p = openModal(`
    <h3>Hinzufügen</h3>
    <div class="menu">
      <button data-a="sheet">📝 Neues Blatt${atRoot ? "" : ` in ${esc(moduleName(moduleId))}`}</button>
      ${atRoot ? `<button data-a="module">🎓 Neues Modul</button>` : `<button data-a="folder">📁 Neuer Ordner</button>`}
      <button data-a="import">📥 Datei hinzufügen (PDF, Word, Excel, Bild …)</button>
      <button data-a="timetable">📅 Stundenplan-Screenshot hinzufügen</button>
    </div>`);
  const m = openModal.lastModal;
  $$("[data-a]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.a)));
  p.then((a) => {
    if (a === "sheet") newSheetDialog({ moduleId, folderId: atRoot ? null : ui.loc.folderId });
    if (a === "module") addModuleDialog();
    if (a === "folder") newFolderDialog(moduleId, ui.loc.folderId);
    if (a === "import") importFiles(moduleId, atRoot ? null : ui.loc.folderId);
    if (a === "timetable") {
      ui.view = "timetable";
      renderAll();
    }
  });
}

// ---------- Externe Dateien importieren ----------

// Kostenlose Bibliotheken, laufen komplett auf dem Gerät
const LIBS = {
  mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
  xlsx: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
  pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
};

const scriptCache = {};
function loadScript(src) {
  scriptCache[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      delete scriptCache[src];
      reject(new Error("Bibliothek konnte nicht geladen werden"));
    };
    document.head.appendChild(s);
  });
  return scriptCache[src];
}

function importFiles(moduleId, folderId) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = async () => {
    const files = [...input.files];
    let lastDoc = null;
    for (const file of files) {
      const res = await importFile(file, moduleId, folderId);
      if (res?.html !== undefined) lastDoc = res;
    }
    persist();
    renderAll();
    toast(`${files.length} Datei(en) hinzugefügt`);
    if (files.length === 1 && lastDoc) openDoc(lastDoc.id);
  };
  input.click();
}

const fileExt = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

// Wandelt eine Datei in ein bearbeitbares Blatt um – was nicht geht, wird als Anhang abgelegt
async function importFile(file, moduleId, folderId) {
  const name = file.name.replace(/\.[^.]+$/, "");
  const ext = fileExt(file.name);
  const busy = toast(`„${file.name}“ wird geöffnet …`, "", 120000);
  const flowDoc = (html) => {
    const doc = createDoc({ moduleId, folderId, kind: "quick", paper: "blank", title: name });
    doc.heading = name;
    doc.html = html;
    return doc;
  };
  try {
    if (["txt", "md", "markdown", "html", "htm"].includes(ext)) {
      const text = await file.text();
      if (ext.startsWith("htm")) return flowDoc(sanitizeHtml(new DOMParser().parseFromString(text, "text/html").body.innerHTML));
      if (ext.startsWith("m")) return flowDoc(markdownToHtml(text));
      return flowDoc(text.split(/\n/).map((l) => `<p>${esc(l) || "<br>"}</p>`).join(""));
    }
    if (ext === "docx") {
      await loadScript(LIBS.mammoth);
      const { value } = await window.mammoth.convertToHtml(
        { arrayBuffer: await file.arrayBuffer() },
        { convertImage: window.mammoth.images.imgElement((img) => img.read("base64").then((b64) => ({ src: `data:${img.contentType};base64,${b64}` }))) }
      );
      return flowDoc(tablesAsTbl(sanitizeHtml(value)) || "<p><br></p>");
    }
    if (ext === "csv") return flowDoc(rowsToTable(parseCsv(await file.text())));
    if (["xlsx", "xls", "ods"].includes(ext)) {
      await loadScript(LIBS.xlsx);
      const wb = window.XLSX.read(await file.arrayBuffer());
      const parts = wb.SheetNames.map((n) => {
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });
        return `${wb.SheetNames.length > 1 ? `<h2>${esc(n)}</h2>` : ""}${rowsToTable(rows)}`;
      });
      return flowDoc(parts.join("<p><br></p>"));
    }
    if (ext === "pdf") return await pdfToDoc(file, name, moduleId, folderId);
    if (file.type.startsWith("image/")) return await imageToDoc(file, name, moduleId, folderId);
    return await addAttachment(file, moduleId, folderId);
  } catch (err) {
    console.error(err);
    toast(`„${file.name}“ konnte nicht umgewandelt werden – als Anhang gespeichert.`, "error", 5000);
    return addAttachment(file, moduleId, folderId);
  } finally {
    busy.remove();
  }
}

function tablesAsTbl(html) {
  const box = document.createElement("div");
  box.innerHTML = html;
  $$("table", box).forEach((t) => (t.className = "tbl"));
  return box.innerHTML;
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function rowsToTable(rows) {
  rows = rows.filter((r) => r.some((c) => String(c).trim()));
  if (!rows.length) return "<p><br></p>";
  const cols = Math.max(...rows.map((r) => r.length));
  return `<table class="tbl"><tbody>${rows
    .map((r, i) => `<tr>${Array.from({ length: cols }, (_, j) => `<td>${i === 0 ? "<b>" : ""}${esc(r[j] ?? "") || "<br>"}${i === 0 ? "</b>" : ""}</td>`).join("")}</tr>`)
    .join("")}</tbody></table><p><br></p>`;
}

// Seitenbild als festen Hintergrund-Block (darauf kann man schreiben und malen)
function pageImageBox(src, n, ratio) {
  let w = SHEET_BASE_WIDTH;
  if (w * ratio > PAGE_H) w = Math.floor(PAGE_H / ratio);
  const x = Math.floor((SHEET_BASE_WIDTH - w) / 2);
  return `<div class="box img-box locked" data-x="${x}" data-y="${n * STRIDE}" data-w="${w}"><img src="${src}" alt=""></div>`;
}

async function pdfToDoc(file, name, moduleId, folderId) {
  await loadScript(LIBS.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = Math.min(pdf.numPages, 80);
  const boxesHtml = [];
  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (SHEET_BASE_WIDTH * 2) / vp1.width });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    boxesHtml.push(pageImageBox(c.toDataURL("image/jpeg", 0.85), i - 1, vp.height / vp.width));
  }
  const doc = createDoc({ moduleId, folderId, kind: "quick", paper: "pdf", title: name });
  doc.heading = "";
  doc.pages = count;
  doc.floats = boxesHtml.join("");
  if (pdf.numPages > count) toast(`Nur die ersten ${count} Seiten wurden übernommen.`, "", 5000);
  return doc;
}

async function imageToDoc(file, name, moduleId, folderId) {
  const src = await downscaleImage(file, 2000);
  const img = new Image();
  await new Promise((r, j) => ((img.onload = r), (img.onerror = j), (img.src = src)));
  const doc = createDoc({ moduleId, folderId, kind: "quick", paper: "pdf", title: name });
  doc.heading = "";
  doc.floats = pageImageBox(src, 0, img.height / img.width);
  return doc;
}

// ---------- Anhänge (Originaldateien) ----------

async function addAttachment(file, moduleId, folderId) {
  const id = uid();
  await putBlob(id, file);
  const now = Date.now();
  const att = { id, semesterId: state.currentSemesterId, moduleId, folderId, name: file.name, mime: file.type, size: file.size, createdAt: now, updatedAt: now };
  state.files.push(att);
  return att;
}

const fileIcon = (name) =>
  ({ pdf: "📕", doc: "📘", docx: "📘", xls: "📗", xlsx: "📗", csv: "📗", ppt: "📙", pptx: "📙", zip: "🗜", mp3: "🎵", m4a: "🎵", mp4: "🎬", mov: "🎬" })[fileExt(name)] || "📄";
const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const CONVERTIBLE = ["pdf", "docx", "xlsx", "xls", "ods", "csv", "txt", "md", "html", "htm", "png", "jpg", "jpeg", "gif", "webp"];

async function openAttachment(att, download = false) {
  const blob = await getBlob(att.id);
  if (!blob) return toast("Datei nicht gefunden.", "error");
  const url = URL.createObjectURL(blob instanceof File ? blob : new File([blob], att.name, { type: att.mime }));
  if (download) {
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name;
    a.click();
  } else if (!window.open(url, "_blank")) location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function attachmentMenu(att) {
  const canEdit = CONVERTIBLE.includes(fileExt(att.name));
  const p = openModal(`
    <h3>${fileIcon(att.name)} ${esc(att.name)}</h3><p class="lead">${esc(moduleName(att.moduleId))} · ${fmtSize(att.size)}</p>
    <div class="menu">
      <button data-a="open">📄 Öffnen</button>
      ${canEdit ? `<button data-a="edit">✏️ Als Blatt bearbeiten</button>` : ""}
      <button data-a="download">⤓ Herunterladen</button>
      <button data-a="rename">✏️ Umbenennen</button>
      <button data-a="move">📁 Verschieben</button>
      <button data-a="delete" class="danger">🗑 Löschen</button>
    </div>`);
  const m = openModal.lastModal;
  $$("[data-a]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.a)));
  const a = await p;
  if (a === "open") openAttachment(att);
  if (a === "download") openAttachment(att, true);
  if (a === "edit") {
    const blob = await getBlob(att.id);
    const doc = await importFile(new File([blob], att.name, { type: att.mime || blob.type }), att.moduleId, att.folderId);
    persist();
    if (doc?.html !== undefined) return openDoc(doc.id);
  }
  if (a === "rename") {
    const name = await promptModal("Umbenennen", "Dateiname", att.name);
    if (name) att.name = name;
  }
  if (a === "move") await moveDialog(att);
  if (a === "delete" && (await confirmModal("Datei löschen?", `„${att.name}“ wird endgültig gelöscht.`, "Löschen", { danger: true }))) {
    state.files = state.files.filter((f) => f.id !== att.id);
    delBlob(att.id);
  }
  persist();
  renderAll();
}

// ============================================================
// Dateiübersicht (wie Apple Dateien)
// ============================================================

function folderSvg(color, emoji = "") {
  return `<span class="folder-wrap"><svg class="folder-ico" viewBox="0 0 74 58"><path d="M4 10a6 6 0 0 1 6-6h17l6 6h31a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="${esc(color)}" opacity=".55"/><path d="M4 18a6 6 0 0 1 6-6h54a6 6 0 0 1 6 6v30a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="${esc(color)}"/></svg>${
    emoji ? `<span class="folder-emoji">${esc(emoji)}</span>` : ""
  }</span>`;
}

// Mini-Vorschau des Blatts (Überschrift + Textanfang) – oder ein eigenes Aussehen
function docPreviewText(doc) {
  const box = document.createElement("div");
  box.innerHTML = (doc.html || "") + (doc.floats || "");
  return box.textContent.replace(/\s+/g, " ").trim().slice(0, 160);
}

function paperIcon(doc) {
  const color = moduleColor(doc.moduleId);
  const c = doc.cover || {};
  if (c.image) return `<div class="paper-ico cover" style="background-image:url('${c.image}')"></div>`;
  if (c.color || c.emoji)
    return `<div class="paper-ico cover" style="background:${esc(c.color || "#fff")}"><span class="cover-emoji">${esc(c.emoji || "")}</span></div>`;
  return `<div class="paper-ico preview paper-${esc(doc.paper)}"><span class="stripe" style="background:${esc(color)}"></span>
    <b style="color:${esc(color)}">${esc(doc.heading ?? doc.title)}</b><span class="pv-text">${esc(docPreviewText(doc))}</span><span class="badge">${KINDS[doc.kind]?.ico || ""}</span></div>`;
}

// Aussehen für Blätter, Ordner und Module ändern: Farbe, Symbol, eigenes Bild
const COVER_EMOJIS = ["📘", "📗", "📙", "📕", "📒", "📓", "📝", "🧪", "📐", "🧠", "💡", "⭐", "🎓", "💼", "🧾", "🗂️", "🌍", "⚖️", "🎨", "🎵"];
async function coverDialog(target, { image = true, color = true } = {}) {
  const cur = target.cover || {};
  let pick = { ...cur };
  const p = openModal(`
    <h3>🎨 Aussehen ändern</h3>
    ${color ? `<div class="field"><span>Farbe</span><div class="chip-wrap">${MODULE_COLORS.map((c) => `<button class="swatch big ${pick.color === c ? "on" : ""}" style="background:${c}" data-cc="${c}"></button>`).join("")}</div></div>` : ""}
    <div class="field"><span>Symbol</span><div class="chip-wrap emoji-pick">${COVER_EMOJIS.map((e) => `<button class="chip ${pick.emoji === e ? "on" : ""}" data-ce="${e}">${e}</button>`).join("")}</div></div>
    ${image ? `<div class="field"><span>Eigenes Bild</span><button class="btn" id="cvImg">🖼 Bild auswählen</button></div>` : ""}
    <div class="modal-actions"><button class="btn left" data-reset>Zurücksetzen</button><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>Fertig</button></div>`);
  const m = openModal.lastModal;
  $$("[data-cc]", m).forEach((b) => (b.onclick = () => ((pick.color = b.dataset.cc), delete pick.image, $$("[data-cc]", m).forEach((x) => x.classList.toggle("on", x === b)))));
  $$("[data-ce]", m).forEach((b) => (b.onclick = () => ((pick.emoji = b.dataset.ce), delete pick.image, $$("[data-ce]", m).forEach((x) => x.classList.toggle("on", x === b)))));
  $("#cvImg", m)?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      if (!input.files[0]) return;
      pick = { image: await downscaleImage(input.files[0], 400) };
      m.close(pick);
    };
    input.click();
  });
  $("[data-reset]", m).onclick = () => m.close({});
  $("[data-x]", m).onclick = () => m.close(null);
  $("[data-ok]", m).onclick = () => m.close(pick);
  const res = await p;
  if (!res) return;
  target.cover = res;
  persist();
  renderAll();
}

function docSubtitle(doc) {
  return `${KINDS[doc.kind]?.label || ""} · ${fmtRelative(doc.updatedAt)}`;
}

function renderFiles(main, recentOnly) {
  const { moduleId, folderId } = ui.loc;
  const atRoot = !recentOnly && moduleId === undefined;
  const crumbs = [];
  if (recentOnly) crumbs.push({ label: "Zuletzt", loc: null });
  else {
    crumbs.push({ label: "Alle Dateien", loc: { moduleId: undefined, folderId: null } });
    if (!atRoot) {
      crumbs.push({ label: moduleName(moduleId), loc: { moduleId, folderId: null } });
      const chain = [];
      let f = state.folders.find((x) => x.id === folderId);
      while (f) {
        chain.unshift(f);
        f = state.folders.find((x) => x.id === f.parentId);
      }
      chain.forEach((c) => crumbs.push({ label: c.name, loc: { moduleId, folderId: c.id } }));
    }
  }

  main.innerHTML = `
    <div class="files-head">
      <div class="crumbs">${crumbs
        .map((c, i) => `${i ? '<span class="sep">›</span>' : ""}<button data-crumb="${i}">${esc(c.label)}</button>`)
        .join("")}</div>
      <input class="input search" id="fileSearch" placeholder="Suchen" value="${esc(ui.search)}">
      <select class="input" id="sortSel" style="width:auto" title="Automatische Sortierung">
        <option value="updated">Zuletzt bearbeitet</option><option value="created">Erstellt</option>
        <option value="name">Name</option><option value="kind">Art</option>
      </select>
      <div class="seg"><button data-layout="grid" title="Symbole">▦</button><button data-layout="list" title="Liste">☰</button></div>
      <button class="plus-btn" id="plusBtn" title="Neu hinzufügen">＋</button>
    </div>
    <div class="files-body" id="filesBody"></div>`;

  $$("[data-crumb]", main).forEach(
    (b) =>
      (b.onclick = () => {
        const c = crumbs[b.dataset.crumb];
        if (!c.loc) return;
        ui.view = "files";
        ui.loc = c.loc;
        renderAll();
      })
  );
  $("#sortSel", main).value = ui.sort;
  $("#sortSel", main).onchange = (e) => {
    ui.sort = e.target.value;
    localStorage.setItem("nh-sort", ui.sort);
    renderFilesBody(recentOnly);
  };
  $$("[data-layout]", main).forEach((b) => {
    b.classList.toggle("on", b.dataset.layout === ui.layout);
    b.onclick = () => {
      ui.layout = b.dataset.layout;
      localStorage.setItem("nh-layout", ui.layout);
      renderFiles(main, recentOnly);
    };
  });
  $("#fileSearch", main).oninput = debounce((e) => {
    ui.search = e.target.value;
    renderFilesBody(recentOnly);
  }, 150);
  $("#plusBtn", main).onclick = plusMenu;
  renderFilesBody(recentOnly);
}

function renderFilesBody(recentOnly) {
  const body = $("#filesBody");
  const { moduleId, folderId } = ui.loc;
  const atRoot = !recentOnly && moduleId === undefined;
  const q = ui.search.trim().toLowerCase();
  let folders = [];
  let docs;

  if (q) {
    const scope = atRoot || recentOnly ? semDocs() : semDocs().filter((d) => d.moduleId === moduleId);
    docs = scope.filter((d) => (d.title + " " + d.html.replace(/<[^>]+>/g, " ")).toLowerCase().includes(q));
  } else if (recentOnly) {
    docs = [...semDocs()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  } else if (atRoot) {
    folders = [
      ...semModules().map((m) => ({ type: "module", id: m.id, name: m.name, color: m.color, emoji: m.cover?.emoji, sub: m.examType || `${semDocs().filter((d) => d.moduleId === m.id).length} Objekte` })),
      { type: "module", id: null, name: "Sonstiges", color: "#8e8e93", sub: `${semDocs().filter((d) => !d.moduleId).length} Objekte` },
    ];
    docs = [];
  } else {
    folders = state.folders
      .filter((f) => f.semesterId === state.currentSemesterId && f.moduleId === moduleId && f.parentId === folderId)
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .map((f) => ({ type: "folder", id: f.id, name: f.name, color: f.cover?.color || moduleColor(moduleId), emoji: f.cover?.emoji, sub: `${[...state.docs, ...state.files].filter((d) => d.folderId === f.id).length} Objekte` }));
    docs = semDocs().filter((d) => d.moduleId === moduleId && d.folderId === folderId);
  }
  if (!recentOnly || q) docs = sortDocs(docs);
  const semFiles = state.files.filter((f) => f.semesterId === state.currentSemesterId);
  let atts = [];
  if (q) atts = semFiles.filter((f) => (atRoot || recentOnly || f.moduleId === moduleId) && f.name.toLowerCase().includes(q));
  else if (recentOnly) atts = [...semFiles].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  else if (!atRoot) atts = semFiles.filter((f) => f.moduleId === moduleId && f.folderId === folderId).sort((a, b) => a.name.localeCompare(b.name, "de"));

  const recent = atRoot && !q ? [...semDocs()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6) : [];

  if (!folders.length && !docs.length && !atts.length && !recent.length && (atRoot || recentOnly || q)) {
    body.innerHTML = `<div class="empty-state"><div class="big">${q ? "🔍" : "🗒"}</div>${
      q ? "Nichts gefunden." : `Noch keine Blätter hier.<br><br><button class="btn primary" id="emptyNew">＋ Neues Blatt</button>`
    }</div>`;
    $("#emptyNew")?.addEventListener("click", () => newSheetDialog({ moduleId: moduleId ?? null, folderId }));
    return;
  }

  const folderTile = (f) =>
    ui.layout === "grid"
      ? `<div class="tile" data-open-${f.type}="${f.id ?? ""}" role="button" tabindex="0">${folderSvg(f.color, f.emoji)}<div class="title">${esc(f.name)}</div><div class="sub">${esc(f.sub)}</div><button class="more" data-more-${f.type}="${f.id ?? ""}">⋯</button></div>`
      : `<div class="row" data-open-${f.type}="${f.id ?? ""}" role="button" tabindex="0"><span>📁</span><span>${esc(f.name)}</span><span class="muted hide-sm">Ordner</span><span class="muted hide-sm">${esc(f.sub)}</span><button class="more" data-more-${f.type}="${f.id ?? ""}">⋯</button></div>`;
  const docTile = (d) =>
    ui.layout === "grid"
      ? `<div class="tile" data-open-doc="${d.id}" role="button" tabindex="0">${paperIcon(d)}<div class="title">${esc(d.title)}</div><div class="sub">${esc(docSubtitle(d))}${
          q || recentOnly || atRoot ? `<br>${esc(moduleName(d.moduleId))}` : ""
        }</div><button class="more" data-more-doc="${d.id}">⋯</button></div>`
      : `<div class="row" data-open-doc="${d.id}" role="button" tabindex="0"><span>${KINDS[d.kind]?.ico}</span><span>${esc(d.title)}${
          q || recentOnly ? ` <span class="kind-pill">${esc(moduleName(d.moduleId))}</span>` : ""
        }</span><span class="muted hide-sm">${esc(KINDS[d.kind]?.label)}</span><span class="muted hide-sm">${esc(fmtRelative(d.updatedAt))}</span><button class="more" data-more-doc="${d.id}">⋯</button></div>`;
  const wrap = (items) => (ui.layout === "grid" ? `<div class="grid">${items}</div>` : `<div class="list">${items}</div>`);

  const activate = (el, fn) => {
    el.addEventListener("click", (e) => !e.target.closest(".more") && fn());
    el.addEventListener("keydown", (e) => e.key === "Enter" && fn());
  };
  let html = "";
  if (recent.length) html += `<div class="files-group-title">Zuletzt bearbeitet</div>` + wrap(recent.map(docTile).join(""));
  if (folders.length) html += `<div class="files-group-title">${atRoot ? `Module · ${esc(currentSemester().name)}` : "Ordner"}</div>` + wrap(folders.map(folderTile).join(""));
  // Im Modulordner steht vorne immer „Neues Blatt“
  const newTile = !atRoot && !recentOnly && !q
    ? ui.layout === "grid"
      ? `<div class="tile new-tile" data-new-sheet role="button" tabindex="0"><div class="paper-ico new">＋</div><div class="title">Neues Blatt</div><div class="sub">${esc(moduleName(moduleId))}</div></div>
         <div class="tile new-tile" data-add-file role="button" tabindex="0"><div class="paper-ico new">📥</div><div class="title">Datei hinzufügen</div><div class="sub">PDF, Word, Excel …</div></div>`
      : `<div class="row new-row" data-new-sheet role="button" tabindex="0"><span>＋</span><span><b>Neues Blatt</b></span><span></span><span></span><span></span></div>
         <div class="row new-row" data-add-file role="button" tabindex="0"><span>📥</span><span><b>Datei hinzufügen</b></span><span></span><span></span><span></span></div>`
    : "";
  if (docs.length || newTile) html += `<div class="files-group-title">${q ? "Suchergebnisse" : "Blätter"}</div>` + wrap(newTile + docs.map(docTile).join(""));
  const fileTile = (f) =>
    ui.layout === "grid"
      ? `<div class="tile" data-open-file="${f.id}" role="button" tabindex="0"><div class="file-ico">${fileIcon(f.name)}<span>${esc(fileExt(f.name).toUpperCase())}</span></div><div class="title">${esc(f.name)}</div><div class="sub">${fmtSize(f.size)}</div><button class="more" data-more-file="${f.id}">⋯</button></div>`
      : `<div class="row" data-open-file="${f.id}" role="button" tabindex="0"><span>${fileIcon(f.name)}</span><span>${esc(f.name)}</span><span class="muted hide-sm">${esc(fileExt(f.name).toUpperCase())}-Datei</span><span class="muted hide-sm">${fmtSize(f.size)}</span><button class="more" data-more-file="${f.id}">⋯</button></div>`;
  if (atts.length) html += `<div class="files-group-title">Dateien</div>` + wrap(atts.map(fileTile).join(""));
  body.innerHTML = html;
  $$("[data-open-file]", body).forEach((el) => activate(el, () => openAttachment(state.files.find((f) => f.id === el.dataset.openFile))));
  $$("[data-more-file]", body).forEach((b) => (b.onclick = (e) => (e.stopPropagation(), attachmentMenu(state.files.find((f) => f.id === b.dataset.moreFile)))));

  $$("[data-open-doc]", body).forEach((el) => activate(el, () => openDoc(el.dataset.openDoc)));
  $$("[data-new-sheet]", body).forEach((el) => activate(el, () => newSheetDialog({ moduleId, folderId })));
  $$("[data-add-file]", body).forEach((el) => activate(el, () => importFiles(moduleId, folderId)));
  $$("[data-open-module]", body).forEach((el) =>
    activate(el, () => {
      ui.loc = { moduleId: el.dataset.openModule || null, folderId: null };
      ui.search = "";
      renderAll();
    })
  );
  $$("[data-open-folder]", body).forEach((el) =>
    activate(el, () => {
      ui.loc = { moduleId, folderId: el.dataset.openFolder };
      ui.search = "";
      renderAll();
    })
  );
  $$("[data-more-doc]", body).forEach((b) => (b.onclick = (e) => (e.stopPropagation(), docMenu(docById(b.dataset.moreDoc)))));
  $$("[data-more-folder]", body).forEach((b) => (b.onclick = (e) => (e.stopPropagation(), folderMenu(state.folders.find((f) => f.id === b.dataset.moreFolder)))));
  $$("[data-more-module]", body).forEach((b) => (b.onclick = (e) => (e.stopPropagation(), moduleMenu(b.dataset.moreModule || null))));
}

async function docMenu(doc) {
  const p = openModal(`
    <h3>${esc(doc.title)}</h3><p class="lead">${esc(moduleName(doc.moduleId))} · ${esc(KINDS[doc.kind]?.label)}</p>
    <div class="menu">
      <button data-a="open">📄 Öffnen</button>
      <button data-a="rename">✏️ Umbenennen</button>
      <button data-a="move">📁 Verschieben</button>
      <button data-a="export">⤓ Exportieren</button>
      <button data-a="dup">⧉ Duplizieren</button>
      <button data-a="cover">🎨 Aussehen ändern</button>
      <button data-a="delete" class="danger">🗑 Löschen</button>
    </div>`);
  const m = openModal.lastModal;
  $$("[data-a]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.a)));
  const a = await p;
  if (a === "open") openDoc(doc.id);
  if (a === "rename") {
    const name = await promptModal("Umbenennen", "Titel", doc.title);
    if (name) {
      doc.title = name;
      doc.updatedAt = Date.now();
    }
  }
  if (a === "move") await moveDialog(doc);
  if (a === "export") await exportDialog([doc], doc.title);
  if (a === "cover") return coverDialog(doc);
  if (a === "dup") {
    const copy = structuredClone(doc);
    Object.assign(copy, { id: uid(), title: doc.title + " (Kopie)", createdAt: Date.now(), updatedAt: Date.now() });
    state.docs.push(copy);
  }
  if (a === "delete" && (await confirmModal("Blatt löschen?", `„${doc.title}“ wird endgültig gelöscht.`, "Löschen", { danger: true }))) {
    state.docs = state.docs.filter((d) => d.id !== doc.id);
  }
  persist();
  if (ui.view !== "editor") renderAll();
}

async function moveDialog(doc) {
  const mods = semModules();
  const p = openModal(`
    <h3>Verschieben</h3>
    <label class="field"><span>Modul</span><select class="input" id="mvMod">
      ${mods.map((m) => `<option value="${m.id}" ${m.id === doc.moduleId ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
      <option value="" ${!doc.moduleId ? "selected" : ""}>Sonstiges</option></select></label>
    <label class="field"><span>Ordner</span><select class="input" id="mvFolder"></select></label>
    <div class="modal-actions"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>Verschieben</button></div>`);
  const m = openModal.lastModal;
  const fill = () => ($("#mvFolder", m).innerHTML = folderOptions($("#mvMod", m).value || null, doc.folderId));
  fill();
  $("#mvMod", m).onchange = fill;
  $("[data-x]", m).onclick = () => m.close(null);
  $("[data-ok]", m).onclick = () => m.close({ moduleId: $("#mvMod", m).value || null, folderId: $("#mvFolder", m).value || null });
  const res = await p;
  if (res) {
    Object.assign(doc, res);
    persist();
  }
}

async function folderMenu(folder) {
  const p = openModal(`
    <h3>📁 ${esc(folder.name)}</h3>
    <div class="menu">
      <button data-a="rename">✏️ Umbenennen</button>
      <button data-a="export">⤓ Alle Blätter exportieren</button>
      <button data-a="cover">🎨 Aussehen ändern</button>
      <button data-a="delete" class="danger">🗑 Ordner löschen</button>
    </div>`);
  const m = openModal.lastModal;
  $$("[data-a]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.a)));
  const a = await p;
  if (a === "rename") {
    const name = await promptModal("Ordner umbenennen", "Name", folder.name);
    if (name) folder.name = name;
  }
  if (a === "export") await exportDialog(sortDocs(state.docs.filter((d) => d.folderId === folder.id)), folder.name);
  if (a === "cover") return coverDialog(folder, { image: false });
  if (a === "delete" && (await confirmModal("Ordner löschen?", "Die Blätter darin bleiben erhalten und rutschen eine Ebene nach oben.", "Löschen", { danger: true }))) {
    [...state.docs, ...state.files].forEach((d) => d.folderId === folder.id && (d.folderId = folder.parentId));
    state.folders.forEach((f) => f.parentId === folder.id && (f.parentId = folder.parentId));
    state.folders = state.folders.filter((f) => f.id !== folder.id);
  }
  persist();
  renderAll();
}

async function moduleMenu(moduleId) {
  const mod = moduleById(moduleId);
  const p = openModal(`
    <h3>${esc(moduleName(moduleId))}</h3>
    <div class="menu">
      <button data-a="new">📝 Neues Blatt</button>
      ${mod ? `<button data-a="rename">✏️ Umbenennen</button><button data-a="cover">🎨 Symbol ändern</button>` : ""}
      <button data-a="export">⤓ Alle Blätter exportieren</button>
      ${mod ? `<button data-a="delete" class="danger">🗑 Modul löschen</button>` : ""}
    </div>`);
  const m = openModal.lastModal;
  $$("[data-a]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.a)));
  const a = await p;
  if (a === "new") return newSheetDialog({ moduleId });
  if (a === "cover") return coverDialog(mod, { image: false, color: false });
  if (a === "rename") {
    const name = await promptModal("Modul umbenennen", "Name", mod.name);
    if (name) mod.name = name;
  }
  if (a === "export") await exportDialog(sortDocs(semDocs().filter((d) => d.moduleId === moduleId)), moduleName(moduleId));
  if (a === "delete" && (await confirmModal("Modul löschen?", "Die Blätter des Moduls werden nach „Sonstiges“ verschoben.", "Löschen", { danger: true }))) {
    [...state.docs, ...state.files].forEach((d) => d.moduleId === moduleId && Object.assign(d, { moduleId: null, folderId: null }));
    state.folders = state.folders.filter((f) => f.moduleId !== moduleId);
    state.modules = state.modules.filter((x) => x.id !== moduleId);
  }
  persist();
  renderAll();
}

// ============================================================
// Editor
// ============================================================

let editorEl = null;
let floatEl = null;
// Liegt ein Knoten im Blatt (Fließtext oder Textfeld)?
const inDoc = (node) => !!node && (editorEl?.contains(node) || floatEl?.contains(node));
let sheetEl = null;
let canvasEl = null;
let resizeObs = null;

// Seitenmaße – alles Vielfache der Zeilenhöhe, damit die Linien über alle Seiten passen
const LINE = 28;
const PAGE_H = 1120; // 40 Zeilen ≈ A4
const PAGE_GAP = 28;
const STRIDE = PAGE_H + PAGE_GAP;
const CONTENT_TOP = 112; // Datum + Überschrift auf Seite 1
const PAGE_TOP = 56;
const PAGE_BOTTOM = 56;
const CM = 37.8;

// Alle Blätter schreiben sich wie Word. Liniert/kariert: Text steht auf den Linien.
// Importierte PDFs/Bilder: aufs Blatt tippen setzt ein Textfeld. Textfelder & Bilder liegen frei verschiebbar darüber.
const isRuled = (doc) => doc.paper === "lined" || doc.paper === "grid";
const isPdf = (doc) => doc.paper === "pdf";

// Alte Blätter (freie Blöcke direkt im Text) auf Fließtext + Textfelder umstellen
function migrateDoc(doc) {
  if (doc.floats !== undefined) return doc;
  const box = document.createElement("div");
  box.innerHTML = doc.html || "";
  const blocks = $$(":scope > .box", box).sort((a, b) => a.dataset.y - b.dataset.y || a.dataset.x - b.dataset.x);
  if (!blocks.length) {
    doc.floats = "";
    return doc;
  }
  const flow = [];
  const floats = [];
  for (const b of blocks) (isPdf(doc) || b.classList.contains("img-box") ? floats.push(b.outerHTML) : flow.push(b.innerHTML));
  doc.html = flow.join("");
  doc.floats = floats.join("");
  return doc;
}

function insets(doc) {
  if (doc.paper !== "blank") return { l: 64, r: 104 };
  const m = doc.margins || {};
  return { l: Math.round((m.l ?? 2.5) * CM), r: Math.round((m.r ?? 2.5) * CM) };
}

function openDoc(id) {
  const doc = docById(id);
  if (!doc) return;
  doc.heading ??= doc.moduleId ? moduleName(doc.moduleId) : "";
  doc.mode ??= "notes";
  migrateDoc(doc);
  doc.margins ??= { l: 2.5, r: 2.5 };
  doc.spacing ??= 1.5;
  doc.pages ??= 1;
  ui.view = "editor";
  ui.docId = id;
  ui.tool = "text";
  ui.panel = doc.mode === "task" ? "task" : null;
  doc.openedAt = Date.now();
  persist();
  renderAll();
}

const currentDoc = () => docById(ui.docId);

function renderEditor(main) {
  const doc = currentDoc();
  main.innerHTML = `
    <div class="editor-wrap">
      <div class="toolbar">
        <button class="tb" data-a="back" title="Zur Dateiübersicht">‹ Dateien</button>
        <button class="tb" data-a="focus" id="focusBtn" title="Vollbild: Seitenleisten aus-/einblenden">⤢</button>
        <input class="doc-title-input" id="fileTitle" value="${esc(doc.title)}" title="Dateiname" placeholder="Dateiname" autocomplete="off">
        <div class="grow"></div>
        <div class="seg" id="modeSeg" title="Modus">
          <button data-mode="normal">Normal</button>
          <button data-mode="notes">Mitschrift</button>
          <button data-mode="task">Aufgabe</button>
        </div>
        <div class="seg" id="toolSeg" title="Schrift / Stift (${MOD}+Alt+P)">
          <button data-tool="text">𝐓 Schrift</button>
          <button data-tool="pen">✎ Stift</button>
        </div>
        <button class="tb" data-a="tidy" title="Rechtschreibung prüfen & aufräumen">✨<span class="lbl"> Aufräumen</span></button>
        <button class="tb" data-a="design" title="Design & Layout">🎨<span class="lbl"> Design</span></button>
        <span class="saved-state" id="savedState"></span>
        <button class="btn primary" data-a="save" title="Speichern (${MOD}+S)">Speichern</button>
        <button class="tb" data-a="export" title="Exportieren">⤓<span class="lbl"> Export</span></button>
      </div>
      <div class="subbar" id="subbar"></div>
      <div class="editor-body">
        <div class="canvas-scroll" id="canvasScroll">
          <div class="sheet-zoom" id="sheetZoom"><div class="sheet-stack" id="sheetStack">
            <div class="sheet" id="sheet">
              <div class="sheet-bg" id="sheetBg"></div>
              <div class="sheet-date">${esc(fmtLong(Date.now()))}${
                sameDay(doc.createdAt, Date.now()) ? "" : `<small>Erstellt am ${esc(fmtShort(doc.createdAt))}</small>`
              }</div>
              <input class="doc-title" id="docTitle" value="${esc(doc.heading)}" placeholder="Überschrift" autocomplete="off" spellcheck="true" autocapitalize="sentences">
              <div class="page-content" id="editor" spellcheck="true" autocorrect="on" autocapitalize="sentences" lang="de"
                data-placeholder="${isPdf(doc) ? "" : "Einfach lostippen …   # Überschrift · - Liste · rot = Fachbegriff"}"></div>
              <div class="float-layer" id="floats"></div>
              <canvas class="draw-layer" id="drawLayer"></canvas>
              <div class="box-tools" id="boxTools" hidden>
                <button class="bt-move" title="Verschieben">⠿</button>
                <button class="bt-del" title="Block löschen">✕</button>
                <span class="bt-resize" title="Breite ändern"></span>
              </div>
              <div class="float-bar" id="lassoBar" hidden><span>✨ Auswahl ziehen zum Verschieben</span></div>
              <div class="float-bar" id="imgBar" hidden>
                <button data-iw="25">25 %</button><button data-iw="50">50 %</button><button data-iw="75">75 %</button><button data-iw="100">100 %</button>
                <button data-ia="left" title="Links">⇤</button><button data-ia="center" title="Mitte">⇹</button><button data-ia="right" title="Rechts">⇥</button>
                <button data-idel title="Bild löschen">🗑</button>
              </div>
            </div>
            <div class="glossary-page"><div class="glossary" id="glossary"></div></div>
          </div></div>
          <div class="doc-stats" id="docStats"></div>
        </div>
        <aside class="side-panel" id="sidePanel" hidden></aside>
      </div>
    </div>`;

  editorEl = $("#editor", main);
  sheetEl = $("#sheet", main);
  canvasEl = $("#drawLayer", main);
  floatEl = $("#floats", main);
  editorEl.innerHTML = sanitizeHtml(doc.html);
  floatEl.innerHTML = sanitizeHtml(doc.floats || "");
  document.execCommand("defaultParagraphSeparator", false, "p");

  applyDocLook();
  setupFloats();
  if (isPdf(doc)) editorEl.contentEditable = "false";
  else {
    editorEl.contentEditable = "true";
    editorEl.addEventListener("focus", () => {
      if (!editorEl.textContent && !editorEl.querySelector("li, h1, h2, h3, img, table, hr")) focusEditorStart();
    });
  }
  renderModeSeg();
  renderToolSeg();
  renderSubbar();
  renderGlossary();
  renderSidePanel();
  setupCanvas();
  setupImages();
  updateSavedState();

  $("#docTitle", main).addEventListener("input", (e) => {
    doc.heading = e.target.value;
    touchDoc();
  });
  $("#fileTitle", main).addEventListener("input", (e) => {
    doc.title = e.target.value;
    touchDoc();
  });
  $("#fileTitle", main).addEventListener("keydown", (e) => e.key === "Enter" && focusEditorStart());
  $("#docTitle", main).addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusEditorStart();
    }
  });
  $$("[data-a]", main.querySelector(".toolbar")).forEach((b) => (b.onclick = () => toolbarAction(b.dataset.a)));

  for (const el of [editorEl, floatEl]) {
    el.addEventListener("input", onEditorInput);
    el.addEventListener("keydown", onEditorKeydown);
    el.addEventListener("paste", onEditorPaste);
    el.addEventListener("click", onEditorClick);
  }

  document.addEventListener("selectionchange", rememberSelection);
  setupFit();
  paginate();
  $("#focusBtn").classList.toggle("on", document.body.classList.contains("focus"));
  if (!editorEl.textContent.trim() && !floatEl.innerHTML.trim()) setTimeout(() => (doc.heading ? focusEditorStart() : $("#docTitle").focus()), 30);
}

// Vollbild: Seitenleisten weg, Blatt so groß wie möglich (Hoch- und Querformat)
function toggleFocus(force) {
  const on = force ?? !document.body.classList.contains("focus");
  document.body.classList.toggle("focus", on);
  localStorage.setItem("nh-focus", on ? "1" : "");
  if (on && ui.panel) {
    ui.panel = null;
    renderSidePanel();
  }
  $("#focusBtn")?.classList.toggle("on", on);
}

let fitObs = null;
let sheetScale = 1;

// Blatt passend zur Bildschirmbreite skalieren – das Layout bleibt gleich, Zeichnungen bleiben an ihrem Platz
function setupFit() {
  fitObs?.disconnect();
  const scroll = $("#canvasScroll");
  const zoom = $("#sheetZoom");
  const stack = $("#sheetStack");
  const fit = () => {
    if (!sheetEl) return;
    const avail = scroll.clientWidth - (scroll.clientWidth < 700 ? 16 : 48);
    sheetScale = Math.max(0.35, Math.min(1.6, avail / SHEET_BASE_WIDTH));
    stack.style.transform = `scale(${sheetScale})`;
    zoom.style.width = SHEET_BASE_WIDTH * sheetScale + "px";
    zoom.style.height = stack.offsetHeight * sheetScale + "px";
    resizeCanvas(true);
    positionFloatBars();
  };
  fitObs = new ResizeObserver(fit);
  fitObs.observe(scroll);
  fitObs.observe(stack);
  fit();
}

// Punkt in Blatt-Koordinaten (unskaliert)
function sheetPoint(e) {
  const r = sheetEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) / sheetScale, y: (e.clientY - r.top) / sheetScale };
}
const relTop = (el) => (el.getBoundingClientRect().top - sheetEl.getBoundingClientRect().top) / sheetScale;

// ---------- Seiten ----------

let paginateQueued = false;
let lastPages = 0;
function paginate() {
  if (paginateQueued) return;
  paginateQueued = true;
  requestAnimationFrame(() => {
    paginateQueued = false;
    if (!editorEl) return;
    const doc = currentDoc();
    const pages = layoutPages(sheetEl, editorEl, doc, sheetScale, floatEl);
    if (pages !== doc.pages) {
      doc.pages = pages;
      persist();
    }
    if (pages !== lastPages) {
      lastPages = pages;
      renderPageBg(sheetEl, pages);
    }
    updateStats(pages);
  });
}

function renderPageBg(sheet, pages) {
  $(".sheet-bg", sheet).innerHTML = Array.from(
    { length: pages },
    (_, n) => `<div class="bg-page" style="top:${n * STRIDE}px"><div class="pg-lines" style="top:${n ? 0 : CONTENT_TOP}px"></div><span class="pg-num">${n + 1}</span></div>`
  ).join("");
  sheet.style.height = pages * STRIDE - PAGE_GAP + "px";
}

// Einheiten für den Seitenumbruch: Absätze, Überschriften, einzelne Listenpunkte, Tabellen, Bilder
function flowUnits(editor) {
  const units = [];
  for (const el of editor.children) {
    if (/^(UL|OL)$/.test(el.tagName)) units.push(...el.children);
    else units.push(el);
  }
  return units;
}

// Rechnet aus, wie viele Seiten gebraucht werden. Im Word-Modus rutschen Absätze, die nicht mehr passen, auf die nächste Seite.
function layoutPages(sheet, editor, doc, scale, floats) {
  // Blattoberkante jedes Mal neu messen – der Browser kann beim Verschieben mitscrollen
  const topOf = (el) => (el.getBoundingClientRect().top - sheet.getBoundingClientRect().top) / scale;
  let floatBottom = 0;
  for (const b of floats ? $$(":scope > .box", floats) : []) floatBottom = Math.max(floatBottom, Number(b.dataset.y) + b.offsetHeight / (b.isConnected ? 1 : 1));
  const floatPages = Math.ceil((floatBottom + (isPdf(doc) ? 0 : PAGE_BOTTOM)) / STRIDE);
  if (isPdf(doc)) return Math.max(doc.pages || 1, floatPages, 1);
  const ruled = isRuled(doc);
  const units = flowUnits(editor);
  units.forEach((u) => {
    u.style.marginTop = "";
    u.style.paddingBottom = "";
    u.style.marginBottom = "";
  });
  let breakNext = false;
  let bottom = CONTENT_TOP;
  for (const u of units) {
    const top = topOf(u);
    let h = u.getBoundingClientRect().height / scale;
    // Liniert/kariert: jeder Block endet auf einer Linie (z. B. nach Bildern oder großer Schrift)
    const rest = h % LINE;
    if (ruled && rest > 0.5 && LINE - rest > 0.5) {
      u.style[/^(TABLE|HR)$/.test(u.tagName) ? "marginBottom" : "paddingBottom"] = LINE - rest + "px";
      h += LINE - rest;
    }
    const n = Math.floor((top + 1) / STRIDE);
    const contentEnd = n * STRIDE + PAGE_H - PAGE_BOTTOM;
    const nextStart = (n + 1) * STRIDE + PAGE_TOP;
    let target = null;
    if (breakNext || (top + h > contentEnd + 1 && h <= PAGE_H - PAGE_TOP - PAGE_BOTTOM)) target = nextStart;
    else if (n > 0 && top < n * STRIDE + PAGE_TOP - 1) target = n * STRIDE + PAGE_TOP;
    breakNext = u.matches("hr.page-break");
    if (target !== null && target > top) u.style.marginTop = target - top + "px";
    bottom = topOf(u) + h;
  }
  return Math.max(1, Math.ceil((bottom + PAGE_BOTTOM) / STRIDE), floatPages);
}

function updateStats(pages) {
  const el = $("#docStats");
  if (!el || !editorEl) return;
  const words = ((editorEl.innerText + " " + floatEl.innerText).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;
  el.textContent = `${pages} ${pages === 1 ? "Seite" : "Seiten"} · ${words} ${words === 1 ? "Wort" : "Wörter"}`;
}

// ---------- Freies Feld (liniert & kariert) ----------

const boxes = () => (floatEl ? $$(":scope > .box", floatEl) : []);

function placeBox(b) {
  b.style.left = Number(b.dataset.x) + "px";
  b.style.top = Number(b.dataset.y) + "px";
  b.style.width = Number(b.dataset.w) + "px";
}

function prepareBox(b) {
  placeBox(b);
  if (!b.classList.contains("img-box")) {
    b.contentEditable = "true";
    b.spellcheck = true;
    b.lang = "de";
    b.setAttribute("autocorrect", "on");
    b.setAttribute("autocapitalize", "sentences");
  }
}

// Zeile einrasten und nie in der Lücke zwischen zwei Seiten landen
function snapY(y) {
  const top = currentDoc()?.paper === "pdf" ? 0 : CONTENT_TOP;
  y = top + Math.max(0, Math.round((y - top) / LINE)) * LINE;
  const n = Math.floor(y / STRIDE);
  if (y > n * STRIDE + PAGE_H - PAGE_BOTTOM) y = (n + 1) * STRIDE + PAGE_TOP;
  if (n > 0 && y < n * STRIDE + PAGE_TOP) y = n * STRIDE + PAGE_TOP;
  return y;
}

function newBox(x, y, html = "<p><br></p>", { cls = "", w } = {}) {
  const doc = currentDoc();
  const ins = insets(doc);
  const b = document.createElement("div");
  b.className = `box ${cls}`.trim();
  b.dataset.x = Math.round(Math.max(ins.l - 40, Math.min(x, SHEET_BASE_WIDTH - ins.r - 80)));
  b.dataset.y = snapY(y);
  b.dataset.w = Math.round(w ?? SHEET_BASE_WIDTH - ins.r - Number(b.dataset.x));
  b.innerHTML = html;
  floatEl.appendChild(b);
  prepareBox(b);
  return b;
}

function caretInto(el, atEnd = true) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(!atEnd);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// Unterkante des untersten Blocks → dort geht's weiter
function nextFreeY() {
  let bottom = CONTENT_TOP;
  for (const b of boxes()) bottom = Math.max(bottom, Number(b.dataset.y) + Math.ceil(b.offsetHeight / LINE) * LINE);
  return snapY(bottom + (boxes().length ? LINE : 0));
}

function setupFloats() {
  const doc = currentDoc();
  boxes().forEach(prepareBox);
  // PDF/Bild: auf eine freie Stelle tippen → neues Textfeld genau dort
  if (isPdf(doc)) {
    sheetEl.addEventListener("pointerdown", (e) => {
      if (ui.tool !== "text" || e.pointerType === "pen" || e.button > 0) return;
      if (e.target.closest(".box:not(.locked), .box-tools, .float-bar, .sel-bar")) return;
      e.preventDefault();
      const p = sheetPoint(e);
      const b = newBox(p.x, p.y - LINE / 2);
      b.focus();
      caretInto(b.firstChild);
      showBoxTools(b);
    });
  }
  floatEl.addEventListener("focusin", (e) => {
    const b = e.target.closest?.(".box");
    if (b) showBoxTools(b);
  });
  floatEl.addEventListener("focusout", (e) => {
    const b = e.target.closest?.(".box");
    setTimeout(() => {
      if (b && b.isConnected && document.activeElement !== b && !b.textContent.trim() && !b.querySelector("img, hr, table")) {
        b.remove();
        hideBoxTools();
        onEditorInput();
      }
    }, 150);
  });
  setupBoxTools();
}

// Frei verschiebbares Textfeld dort, wo man gerade hinschaut
function insertFloatText() {
  const scroll = $("#canvasScroll");
  const r = sheetEl.getBoundingClientRect();
  const view = (scroll.getBoundingClientRect().top + scroll.clientHeight / 3 - r.top) / sheetScale;
  // unter den vorhandenen Text, damit nichts übereinander liegt
  const last = editorEl.lastElementChild;
  const textEnd = last && last.textContent.trim() ? relTop(last) + last.getBoundingClientRect().height / sheetScale + LINE : CONTENT_TOP;
  const b = newBox(insets(currentDoc()).l + 40, Math.max(CONTENT_TOP, view, textEnd), "<p><br></p>", { w: 300 });
  b.focus();
  caretInto(b.firstChild);
  showBoxTools(b);
  onEditorInput();
}

let activeBox = null;

function showBoxTools(b) {
  activeBox = b;
  $("#boxTools").hidden = false;
  positionFloatBars();
}

function hideBoxTools() {
  activeBox = null;
  const t = $("#boxTools");
  if (t) t.hidden = true;
}

function positionFloatBars() {
  const t = $("#boxTools");
  if (t && activeBox?.isConnected) {
    const x = Number(activeBox.dataset.x);
    const y = Number(activeBox.dataset.y);
    Object.assign(t.style, { left: x - 30 + "px", top: y + "px", width: Number(activeBox.dataset.w) + 30 + "px", height: Math.max(LINE, activeBox.offsetHeight) + "px" });
  } else if (t) t.hidden = true;
}

function setupBoxTools() {
  const tools = $("#boxTools");
  const drag = (handle, onMove) => {
    handle.addEventListener("pointerdown", (e) => {
      if (!activeBox) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const b = activeBox;
      const start = { x: e.clientX, y: e.clientY, bx: Number(b.dataset.x), by: Number(b.dataset.y), bw: Number(b.dataset.w) };
      const move = (ev) => {
        onMove(b, (ev.clientX - start.x) / sheetScale, (ev.clientY - start.y) / sheetScale, start);
        placeBox(b);
        positionFloatBars();
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        b.dataset.y = snapY(Number(b.dataset.y));
        b.dataset.x = Math.round(Number(b.dataset.x) / 2) * 2;
        placeBox(b);
        positionFloatBars();
        onEditorInput();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  };
  drag($(".bt-move", tools), (b, dx, dy, s) => {
    b.dataset.x = Math.max(0, Math.min(SHEET_BASE_WIDTH - 60, s.bx + dx));
    b.dataset.y = Math.max(isPdf(currentDoc()) ? 0 : CONTENT_TOP, s.by + dy);
  });
  drag($(".bt-resize", tools), (b, dx, _dy, s) => {
    b.dataset.w = Math.max(80, Math.min(SHEET_BASE_WIDTH - Number(b.dataset.x), s.bw + dx));
  });
  $(".bt-del", tools).addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!activeBox) return;
    activeBox.remove();
    hideBoxTools();
    onEditorInput();
  });
}

// ---------- Bilder ----------

let activeImg = null;

function setupImages() {
  const bar = $("#imgBar");
  $$("button", bar).forEach((b) =>
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!activeImg) return;
      const box = activeImg.closest(".box");
      if (b.dataset.iw) {
        if (box) box.dataset.w = Math.round(((SHEET_BASE_WIDTH - insets(currentDoc()).r - Number(box.dataset.x)) * Number(b.dataset.iw)) / 100);
        else activeImg.style.width = b.dataset.iw + "%";
        if (box) placeBox(box);
      }
      if (b.dataset.ia) {
        const p = activeImg.closest("p");
        if (p && !box) p.style.textAlign = b.dataset.ia;
      }
      if ("idel" in b.dataset) {
        (box || activeImg).remove();
        selectImage(null);
      }
      onEditorInput();
      positionImgBar();
    })
  );
}

function selectImage(img) {
  $$("img.selected", sheetEl).forEach((i) => i.classList.remove("selected"));
  activeImg = img;
  const bar = $("#imgBar");
  if (!bar) return;
  bar.hidden = !img;
  if (img) {
    img.classList.add("selected");
    positionImgBar();
  }
}

function positionImgBar() {
  if (!activeImg?.isConnected) return;
  const r = activeImg.getBoundingClientRect();
  const s = sheetEl.getBoundingClientRect();
  Object.assign($("#imgBar").style, { left: (r.left - s.left) / sheetScale + "px", top: Math.max(0, (r.top - s.top) / sheetScale - 44) + "px" });
}

function onEditorClick(e) {
  const img = e.target.closest?.("img");
  selectImage(img || null);
  if (img?.closest(".img-box")) showBoxTools(img.closest(".img-box"));
  // Checkliste: auf das Kästchen tippen = abhaken
  const li = e.target.closest?.("ul.checklist > li");
  if (li && e.clientX - li.getBoundingClientRect().left < 26 * sheetScale) {
    li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
    onEditorInput();
  }
}

function insertImage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const src = await downscaleImage(file, 1600);
    const doc = currentDoc();
    if (isPdf(doc)) {
      const b = newBox(insets(doc).l, nextFreeY(), `<img src="${src}" alt="">`, { cls: "img-box", w: 320 });
      showBoxTools(b);
      b.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      restoreSelection();
      document.execCommand("insertHTML", false, `<p><img src="${src}" alt="" style="width:60%"></p><p><br></p>`);
    }
    onEditorInput();
  };
  input.click();
}

// ---------- Darstellung ----------

// Auswahl merken, damit Farbfeld & Menüs die markierte Stelle treffen
let savedRange = null;
function rememberSelection() {
  const sel = getSelection();
  if (editorEl && sel.rangeCount && inDoc(sel.getRangeAt(0).commonAncestorContainer)) {
    savedRange = sel.getRangeAt(0).cloneRange();
    updateFormatSelect();
  }
  updateSelBar();
}

// Kleine Leiste direkt unter einem markierten Wort: Farbe, Textmarker, Fachbegriff
function updateSelBar() {
  let bar = $("#selBar");
  const sel = getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  const show = editorEl && ui.tool === "text" && range && !sel.isCollapsed && inDoc(range.commonAncestorContainer) && sel.toString().trim();
  if (!show) {
    if (bar && !bar.contains(document.activeElement)) bar.hidden = true;
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "selBar";
    bar.className = "sel-bar";
    bar.innerHTML = `${TEXT_COLORS.map(([c, n]) => `<button class="swatch" style="background:${c}" data-sc="${c}" title="${n}"></button>`).join("")}
      <label class="swatch rainbow" title="Alle Farben"><input type="color" id="selColor" value="#7d3cc8"></label>
      <button class="sb-btn" data-sa="highlight" title="Textmarker">🖍</button>
      <button class="sb-btn" data-sa="bold" title="Fett"><b>B</b></button>
      <button class="sb-btn term" data-sa="term" title="Als Fachbegriff markieren">● Fachbegriff</button>`;
    document.body.appendChild(bar);
    $$("button", bar).forEach((b) => b.addEventListener("pointerdown", (e) => e.preventDefault()));
    $$("[data-sc]", bar).forEach((b) => b.addEventListener("click", () => applyTextColor(b.dataset.sc)));
    $$("[data-sa]", bar).forEach((b) => b.addEventListener("click", () => runCommand(b.dataset.sa)));
    $("#selColor", bar).addEventListener("input", (e) => {
      e.target.parentElement.style.setProperty("--picked", e.target.value);
      applyTextColor(e.target.value);
    });
  }
  bar.hidden = false;
  const r = range.getBoundingClientRect();
  const w = bar.offsetWidth;
  bar.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  // unter die Markierung, damit das iPad-Menü (Kopieren …) oben frei bleibt
  bar.style.top = Math.min(innerHeight - 52, r.bottom + 10) + "px";
}

function restoreSelection() {
  if (!savedRange || !inDoc(savedRange.commonAncestorContainer)) return focusEditorStart();
  const host = savedRange.commonAncestorContainer.nodeType === 1 ? savedRange.commonAncestorContainer : savedRange.commonAncestorContainer.parentElement;
  (host.closest(".box") || editorEl).focus();
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
}

function applyTextColor(color) {
  restoreSelection();
  document.execCommand("styleWithCSS", false, true);
  document.execCommand("foreColor", false, color);
  onEditorInput();
}

function applyDocLook() {
  const doc = currentDoc();
  sheetEl.classList.remove("paper-lined", "paper-blank", "paper-grid", "paper-pdf", "ruled", "flow");
  sheetEl.classList.add(`paper-${doc.paper}`, isRuled(doc) ? "ruled" : "flow");
  const d = doc.design || {};
  const accent = d.accentColor || moduleColor(doc.moduleId);
  const ins = insets(doc);
  const props = {
    "--page-bg": d.pageColor || "#ffffff",
    "--heading": d.headingColor || accent,
    "--doc-accent": accent,
    "--doc-font": FONTS[doc.font] || FONTS[state.settings.font] || FONTS.Arial,
    "--pad-l": ins.l + "px",
    "--pad-r": ins.r + "px",
    "--spacing": doc.spacing || 1.5,
  };
  for (const el of [sheetEl, $(".glossary-page")]) for (const [k, v] of Object.entries(props)) el?.style.setProperty(k, v);
  paginate();
}

function focusEditorStart() {
  const doc = currentDoc();
  if (isPdf(doc)) return;
  editorEl.focus();
  if (!editorEl.firstChild) editorEl.innerHTML = "<p><br></p>";
  caretInto(editorEl.firstChild, false);
}

function renderModeSeg() {
  const doc = currentDoc();
  $$("#modeSeg button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === doc.mode);
    b.onclick = () => {
      doc.mode = b.dataset.mode;
      ui.panel = doc.mode === "task" ? "task" : ui.panel === "task" ? null : ui.panel;
      persist();
      renderModeSeg();
      renderSidePanel();
    };
  });
}

function renderToolSeg() {
  $$("#toolSeg button").forEach((b) => {
    b.classList.toggle("on", b.dataset.tool === ui.tool);
    b.onclick = () => setTool(b.dataset.tool);
  });
  sheetEl.classList.toggle("pen-mode", ui.tool === "pen");
}

function setTool(tool) {
  ui.tool = tool;
  clearLasso();
  if (tool === "pen") {
    hideBoxTools();
    selectImage(null);
  }
  renderToolSeg();
  renderSubbar();
  if (tool === "text") focusEditorStart();
}

// ---------- Kleine Ausklapp-Menüs ----------

function popMenu(anchor, items) {
  $$(".pop").forEach((p) => p.remove());
  const pop = document.createElement("div");
  pop.className = "pop";
  for (const item of items) {
    if (item === "-") {
      pop.insertAdjacentHTML("beforeend", "<hr>");
      continue;
    }
    const b = document.createElement("button");
    b.innerHTML = item.label;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      pop.remove();
      item.run();
    });
    pop.appendChild(b);
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + "px";
  pop.style.top = r.bottom + 4 + "px";
  setTimeout(() => {
    const close = (e) => {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("pointerdown", close, true);
      }
    };
    document.addEventListener("pointerdown", close, true);
  });
}

// ---------- Schrift-Leiste ----------

const BLOCK_FORMATS = [
  ["p", "Normaler Text"],
  ["h1", "Überschrift 1"],
  ["h2", "Überschrift 2"],
  ["h3", "Überschrift 3"],
];

function renderSubbar() {
  const bar = $("#subbar");
  if (ui.tool === "text") {
    const doc = currentDoc();
    const font = FONTS[doc.font] ? doc.font : state.settings.font;
    bar.innerHTML = `
      <select id="blockSel" title="Format: Text oder Überschrift">${BLOCK_FORMATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <select id="fontSel" title="Schriftart für dieses Blatt">
        ${Object.keys(FONTS).map((f) => `<option ${f === font ? "selected" : ""} style="font-family:${FONTS[f]}">${f}</option>`).join("")}
      </select>
      <select id="sizeSel" title="Schriftgröße für Markierung">
        ${[10, 11, 12, 14, 16, 18, 22, 28].map((s) => `<option value="${s}" ${s === state.settings.fontSize ? "selected" : ""}>${s} pt</option>`).join("")}
      </select>
      <span class="divider"></span>
      <button class="tb" data-cmd="bold" title="Fett (${MOD}+B)"><b>B</b></button>
      <button class="tb" data-cmd="italic" title="Kursiv (${MOD}+I)"><i>I</i></button>
      <button class="tb" data-cmd="underline" title="Unterstrichen (${MOD}+U)"><u>U</u></button>
      <button class="tb" data-cmd="strikeThrough" title="Durchgestrichen"><s>S</s></button>
      <span class="divider"></span>
      ${TEXT_COLORS.map(([c, n]) => `<button class="swatch" style="background:${c}" data-color="${c}" title="${n}"></button>`).join("")}
      <label class="swatch rainbow" title="Alle Farben"><input type="color" id="textColorPick" value="#7d3cc8"></label>
      <button class="tb hl-btn" data-cmd="highlight" title="Textmarker (gelb)">🖍</button>
      <button class="tb term-btn" data-cmd="term" title="Fachbegriff rot markieren (${MOD}+Shift+F)">● Fachbegriff</button>
      <span class="divider"></span>
      <button class="tb" data-cmd="insertUnorderedList" title="Stichpunkte (${MOD}+Shift+L)">• Stichpunkte</button>
      <button class="tb" data-cmd="insertOrderedList" title="Nummerierte Liste">1. Nummeriert</button>
      <button class="tb" data-cmd="checklist" title="Checkliste zum Abhaken">☑ Checkliste</button>
      <span class="divider"></span>
      <button class="tb" data-menu="align" title="Ausrichtung">≡ ▾</button>
      <button class="tb" data-menu="insert" title="Einfügen: Bild, Tabelle …">＋ Einfügen ▾</button>
      <button class="tb" data-menu="more" title="Mehr Formatierung">⋯</button>
      <button class="tb undo" data-cmd="undo" title="Rückgängig (${MOD}+Z)">↶</button>
      <button class="tb undo" data-cmd="redo" title="Wiederholen">↷</button>`;
    $$("[data-cmd]", bar).forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => runCommand(b.dataset.cmd);
    });
    $$("[data-color]", bar).forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => applyTextColor(b.dataset.color);
    });
    $$("[data-menu]", bar).forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => openTextMenu(b.dataset.menu, b);
    });
    const pick = $("#textColorPick", bar);
    pick.addEventListener("input", () => {
      pick.parentElement.style.setProperty("--picked", pick.value);
      applyTextColor(pick.value);
    });
    $("#blockSel", bar).onchange = (e) => {
      restoreSelection();
      setBlock(e.target.value);
    };
    $("#fontSel", bar).onchange = (e) => {
      doc.font = e.target.value;
      applyDocLook();
      touchDoc();
    };
    $("#sizeSel", bar).onchange = (e) => applyFontSize(Number(e.target.value));
    updateFormatSelect();
  } else {
    renderPenBar(bar);
  }
}

function updateFormatSelect() {
  const sel = $("#blockSel");
  const block = currentBlock();
  if (sel && block) sel.value = /^H[1-3]$/.test(block.tagName) ? block.tagName.toLowerCase() : "p";
}

function inTable() {
  const n = savedRange?.startContainer;
  const el = n && (n.nodeType === 1 ? n : n.parentElement);
  return el?.closest?.("td, th") || null;
}

function openTextMenu(which, anchor) {
  const doc = currentDoc();
  const exec = (cmd, val = null) => () => {
    restoreSelection();
    document.execCommand("styleWithCSS", false, cmd === "hiliteColor");
    document.execCommand(cmd, false, val);
    onEditorInput();
  };
  if (which === "align") {
    popMenu(anchor, [
      { label: "⇤ Linksbündig", run: exec("justifyLeft") },
      { label: "⇹ Zentriert", run: exec("justifyCenter") },
      { label: "⇥ Rechtsbündig", run: exec("justifyRight") },
      { label: "☰ Blocksatz", run: exec("justifyFull") },
      "-",
      { label: "→ Einzug vergrößern", run: () => indentBlock(1) },
      { label: "← Einzug verkleinern", run: () => indentBlock(-1) },
    ]);
  }
  if (which === "insert") {
    const cell = inTable();
    popMenu(anchor, [
      { label: "🖼 Bild (Foto / Datei)", run: insertImage },
      { label: "▦ Tabelle", run: insertTable },
      { label: "☑ Checkliste", run: () => runCommand("checklist") },
      { label: "― Trennlinie", run: () => insertBlocks("<hr><p><br></p>") },
      { label: "🔲 Textfeld (frei verschiebbar)", run: insertFloatText },
      ...(isPdf(doc) ? [] : [{ label: "⤓ Seitenumbruch", run: () => insertBlocks('<hr class="page-break"><p><br></p>') }]),
      ...(cell
        ? [
            "-",
            { label: "Tabelle: ＋ Zeile", run: () => tableEdit("row+") },
            { label: "Tabelle: ＋ Spalte", run: () => tableEdit("col+") },
            { label: "Tabelle: − Zeile", run: () => tableEdit("row-") },
            { label: "Tabelle: − Spalte", run: () => tableEdit("col-") },
            { label: "Tabelle löschen", run: () => tableEdit("del") },
          ]
        : []),
    ]);
  }
  if (which === "more") {
    popMenu(anchor, [
      { label: "x² Hochgestellt", run: exec("superscript") },
      { label: "x₂ Tiefgestellt", run: exec("subscript") },
      { label: "🖍 Textmarker entfernen", run: exec("hiliteColor", "transparent") },
      { label: "⌫ Formatierung entfernen", run: exec("removeFormat") },
      "-",
      { label: "Wörter zählen", run: () => toast($("#docStats").textContent, "", 3500) },
    ]);
  }
}

// Fügt Blöcke an der Cursorstelle ein (Word-Modus) bzw. als neuen Block darunter (freies Feld)
function insertBlocks(html) {
  const doc = currentDoc();
  const host = savedRange && (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement)?.closest(".box");
  if (host || isPdf(doc)) {
    if (host && !host.classList.contains("img-box")) {
      restoreSelection();
      document.execCommand("insertHTML", false, html);
    } else {
      const b = newBox(insets(doc).l, nextFreeY(), html);
      b.focus();
      caretInto(b.firstElementChild || b, false);
      showBoxTools(b);
    }
  } else {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
  }
  onEditorInput();
}

// Fügt Blöcke immer ans Ende an und gibt die neuen Elemente zurück (für Vorlagen)
function appendBlocks(html) {
  const doc = currentDoc();
  let host = editorEl;
  if (isPdf(doc)) {
    host = newBox(insets(doc).l, nextFreeY(), "");
    showBoxTools(host);
  }
  const before = host.children.length;
  host.insertAdjacentHTML("beforeend", html);
  onEditorInput();
  normalizeBlocks();
  return [...host.children].slice(before);
}

function insertTable() {
  insertBlocks(`<table class="tbl"><tbody>${"<tr><td><br></td><td><br></td><td><br></td></tr>".repeat(3)}</tbody></table><p><br></p>`);
  // Cursor in die erste Zelle setzen
  const sel = getSelection();
  const at = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
  const tables = $$("table.tbl", editorEl);
  const table = at?.closest("p")?.previousElementSibling?.matches("table") ? at.closest("p").previousElementSibling : tables[tables.length - 1];
  const cell = table?.querySelector("td");
  if (cell) caretInto(cell, false);
}

function tableEdit(action) {
  const cell = inTable();
  if (!cell) return;
  const row = cell.parentElement;
  const table = cell.closest("table");
  const col = [...row.children].indexOf(cell);
  if (action === "row+") row.insertAdjacentHTML("afterend", `<tr>${"<td><br></td>".repeat(row.children.length)}</tr>`);
  if (action === "col+") $$("tr", table).forEach((tr) => tr.children[col].insertAdjacentHTML("afterend", "<td><br></td>"));
  if (action === "row-") row.parentElement.children.length > 1 ? row.remove() : table.remove();
  if (action === "col-") row.children.length > 1 ? $$("tr", table).forEach((tr) => tr.children[col]?.remove()) : table.remove();
  if (action === "del") table.remove();
  onEditorInput();
}

function indentBlock(dir) {
  restoreSelection();
  const block = currentBlock();
  if (!block) return;
  if (/^(UL|OL)$/.test(block.tagName)) {
    document.execCommand(dir > 0 ? "indent" : "outdent");
  } else {
    const next = Math.max(0, Math.min(5 * 47, (parseInt(block.style.paddingLeft) || 0) + dir * 47));
    block.style.paddingLeft = next ? next + "px" : "";
  }
  onEditorInput();
}

function runCommand(cmd) {
  restoreSelection();
  if (cmd === "term") return toggleTerm();
  if (cmd === "highlight") {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("hiliteColor", false, "#fff176");
    return onEditorInput();
  }
  if (cmd === "checklist") {
    const li = getSelection().anchorNode?.parentElement?.closest("li") || (getSelection().anchorNode?.closest?.("li") ?? null);
    if (!li) document.execCommand("insertUnorderedList");
    const ul = (getSelection().anchorNode?.nodeType === 1 ? getSelection().anchorNode : getSelection().anchorNode?.parentElement)?.closest("ul");
    if (ul) {
      ul.classList.toggle("checklist");
      $$(":scope > li", ul).forEach((x) => (x.dataset.checked ||= "false"));
    }
    unnestBlocks();
    return onEditorInput();
  }
  document.execCommand("styleWithCSS", false, false);
  document.execCommand(cmd, false, null);
  onEditorInput();
}

function setBlock(tag) {
  const current = currentBlock();
  const isSame = current && current.tagName.toLowerCase() === tag;
  document.execCommand("formatBlock", false, isSame ? "p" : tag);
  onEditorInput();
  updateFormatSelect();
}

// Der Absatz (bzw. die Liste), in dem der Cursor steht – im freien Feld innerhalb des Textblocks
function currentBlock() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  let n = sel.anchorNode;
  while (n && n.parentNode && n.parentNode !== editorEl && !n.parentNode.classList?.contains("box")) n = n.parentNode;
  return n && n.nodeType === 1 && !n.classList.contains("box") && n !== editorEl ? n : null;
}

function applyFontSize(pt) {
  restoreSelection();
  ui.pendingFontSize = pt;
  document.execCommand("styleWithCSS", false, false);
  document.execCommand("fontSize", false, "7");
  normalizeFonts();
  onEditorInput();
}

// execCommand erzeugt <font>-Tags – wir machen daraus saubere <span>s, Schriftart bleibt immer gleich
function normalizeFonts() {
  for (const f of [...$$("font", editorEl), ...$$("font", floatEl)]) {
    const span = document.createElement("span");
    if (f.getAttribute("size") === "7" && ui.pendingFontSize) span.style.fontSize = ui.pendingFontSize + "pt";
    if (f.getAttribute("color")) span.style.color = f.getAttribute("color");
    span.append(...f.childNodes);
    f.replaceWith(span);
  }
  for (const s of [...$$('span[style*="xxx-large"]', editorEl), ...$$('span[style*="xxx-large"]', floatEl)]) {
    s.style.fontSize = ui.pendingFontSize ? ui.pendingFontSize + "pt" : "";
  }
}

function toggleTerm() {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!inDoc(range.commonAncestorContainer)) return;
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const existing = startEl.closest("span.term");
  if (existing && inDoc(existing)) {
    existing.replaceWith(...existing.childNodes);
  } else if (!sel.isCollapsed) {
    const span = document.createElement("span");
    span.className = "term";
    span.appendChild(range.extractContents());
    span.querySelectorAll("span.term").forEach((t) => t.replaceWith(...t.childNodes));
    range.insertNode(span);
    const after = document.createRange();
    after.setStartAfter(span);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  } else {
    toast("Markiere zuerst ein Wort – es wird dann rot als Fachbegriff markiert.");
    return;
  }
  onEditorInput();
}

const MD_SHORTCUTS = { "#": "h1", "##": "h2", "###": "h3", "-": "ul", "*": "ul", "•": "ul", "1.": "ol" };

function onEditorKeydown(e) {
  // Markdown-Kürzel am Zeilenanfang: "# " → Überschrift, "- " → Liste
  if (e.key === " " && !e.shiftKey) {
    const block = currentBlock();
    const sel = getSelection();
    if (block && sel.isCollapsed && !block.closest("ul,ol") && /^(P|DIV|H[1-3])$/.test(block.tagName)) {
      const text = block.textContent;
      const kind = MD_SHORTCUTS[text.trim()];
      const r = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(block);
      pre.setEnd(r.startContainer, r.startOffset);
      if (kind && pre.toString() === text) {
        e.preventDefault();
        block.innerHTML = "<br>";
        const caret = document.createRange();
        caret.setStart(block, 0);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        if (kind === "ul" || kind === "ol") {
          document.execCommand(kind === "ul" ? "insertUnorderedList" : "insertOrderedList");
          const li = getSelection().anchorNode?.closest?.("li") || getSelection().anchorNode?.parentElement?.closest("li");
          unnestBlocks();
          if (li) {
            const c = document.createRange();
            c.setStart(li, 0);
            c.collapse(true);
            sel.removeAllRanges();
            sel.addRange(c);
          }
        } else document.execCommand("formatBlock", false, kind);
        onEditorInput();
      }
    }
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const inList = currentBlock()?.closest?.("ul,ol") || getSelection().anchorNode?.parentElement?.closest("li");
    if (inList) document.execCommand(e.shiftKey ? "outdent" : "indent");
    else document.execCommand("insertText", false, "    ");
  }
}

function onEditorPaste(e) {
  // Bilder aus der Zwischenablage einfügen, Text immer ohne fremde Formatierung
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  e.preventDefault();
  if (file) {
    downscaleImage(file, 1600).then((src) => {
      if (isPdf(currentDoc())) {
        const b = newBox(insets(currentDoc()).l, nextFreeY(), `<img src="${src}" alt="">`, { cls: "img-box", w: 320 });
        showBoxTools(b);
      } else document.execCommand("insertHTML", false, `<img src="${src}" alt="" style="width:60%">`);
      onEditorInput();
    });
    return;
  }
  const text = e.clipboardData.getData("text/plain");
  document.execCommand("insertHTML", false, text.split(/\r?\n/).map((l) => esc(l)).join("<br>"));
}

const onEditorInput = (() => {
  const later = debounce(() => {
    renderGlossary();
    resizeCanvas();
  }, 400);
  return () => {
    normalizeFonts();
    const doc = currentDoc();
    if (!doc || !editorEl) return;
    doc.html = editorEl.innerHTML;
    doc.floats = floatEl.innerHTML;
    touchDoc();
    paginate();
    positionFloatBars();
    if (activeImg) positionImgBar();
    later();
  };
})();

function touchDoc() {
  const doc = currentDoc();
  doc.updatedAt = Date.now();
  persist();
  updateSavedState("Bearbeitet …");
  saveIndicator();
}
const saveIndicator = debounce(() => updateSavedState(), 900);

function updateSavedState(text) {
  const el = $("#savedState");
  if (!el) return;
  const doc = currentDoc();
  el.textContent = text || (pendingBlocks(doc).length && doc.kind !== "block" && doc.mode !== "normal" ? "Gespeichert · nicht verbessert" : "Gespeichert ✓");
}

// ---------- Blöcke & Verbesserung ----------

// Wo die Absätze liegen: im Word-Modus direkt im Blatt, im freien Feld in den Textblöcken
const containers = () => (editorEl ? [...(isPdf(currentDoc()) ? [] : [editorEl]), ...boxes().filter((b) => !b.classList.contains("img-box"))] : []);
const allBlocks = () => containers().flatMap((c) => [...c.children]);
const findBlock = (bid) => allBlocks().find((el) => el.dataset.bid === bid) || null;

// Jeder Absatz bekommt eine feste ID, damit nur Bearbeitetes verbessert wird
function normalizeBlocks() {
  if (!editorEl) return;
  for (const c of containers()) {
    unnestBlocks(c);
    let pendingInline = [];
    const flush = (before) => {
      if (!pendingInline.length) return;
      const p = document.createElement("p");
      c.insertBefore(p, before);
      p.append(...pendingInline);
      pendingInline = [];
    };
    for (const node of [...c.childNodes]) {
      const isBlock = node.nodeType === 1 && /^(P|DIV|H1|H2|H3|UL|OL|TABLE|HR)$/.test(node.tagName);
      if (isBlock) flush(node);
      else if (node.nodeType === 3 && !node.textContent.trim() && !pendingInline.length) node.remove();
      else pendingInline.push(node);
    }
    flush(null);
    for (const el of [...c.children]) {
      if (el.tagName === "DIV") {
        const p = document.createElement("p");
        p.append(...el.childNodes);
        el.replaceWith(p);
      }
    }
    for (const el of c.children) if (!el.dataset.bid) el.dataset.bid = uid().slice(0, 8);
  }
  currentDoc().html = editorEl.innerHTML;
  currentDoc().floats = floatEl.innerHTML;
}

// Browser verschachteln Listen/Überschriften manchmal in <p> – wieder auf eine Ebene holen
function unnestBlocks(container) {
  for (const c of container ? [container] : containers()) {
    for (const p of [...c.children]) {
      if (/^(P|DIV)$/.test(p.tagName) && p.querySelector(":scope > ul, :scope > ol, :scope > h1, :scope > h2, :scope > h3, :scope > p, :scope > table")) {
        p.replaceWith(...[...p.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim()));
      }
    }
  }
}

// Vergleich über Text + Fachbegriffe, damit reine Formatierungen nicht als „bearbeitet“ zählen
const blockHash = (el) => hash(el.tagName + el.textContent + "|" + [...el.querySelectorAll("span.term")].map((t) => t.textContent).join(","));

function blockElements(doc) {
  if (editorEl && ui.docId === doc.id) return allBlocks();
  migrateDoc(doc);
  const box = document.createElement("div");
  box.innerHTML = doc.html + (doc.floats || "");
  return [...box.children].flatMap((el) => (el.classList.contains("box") ? (el.classList.contains("img-box") ? [] : [...el.children]) : [el]));
}

function pendingBlocks(doc) {
  if (!doc) return [];
  return blockElements(doc).filter((el) => el.textContent.trim() && doc.improved[el.dataset.bid] !== blockHash(el));
}

function termsInDoc() {
  const seen = new Map();
  for (const t of [...$$("span.term", editorEl), ...$$("span.term", floatEl)]) {
    const term = t.textContent.trim().replace(/[.,;:!?]+$/, "");
    if (term && !seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
  }
  return [...seen.values()];
}

async function saveDoc({ ask = true } = {}) {
  const doc = currentDoc();
  if (!doc) return;
  normalizeBlocks();
  doc.updatedAt = Date.now();
  await writeState();
  if (doc.kind === "block") {
    updateSavedState();
    toast("Gespeichert ✓ (Collegeblock – wird nicht verarbeitet)");
    return;
  }
  const changed = pendingBlocks(doc);
  const sig = hash(changed.map(blockHash).join("|"));
  if (!ask || doc.mode === "normal" || !changed.length || doc.declinedSig === sig) {
    updateSavedState();
    toast("Gespeichert ✓");
    return;
  }
  const yes = await confirmModal(
    "Gespeichert ✓ – jetzt verbessern?",
    `Soll ich die ${changed.length === 1 ? "bearbeitete Stelle" : `${changed.length} bearbeiteten Stellen`} verbessern? Rechtschreibung & Grammatik werden geprüft und die Formatierung wird aufgeräumt – kostenlos. Nur Bearbeitetes wird angefasst.`,
    "Ja, verbessern",
    { cancelLabel: "Nein, so lassen" }
  );
  if (!yes) {
    doc.declinedSig = sig;
    persist();
    updateSavedState();
    return;
  }
  await improveBlocks(changed, { spelling: true, tidy: true });
}

// „Aufräumen“-Knopf: ganzes Blatt, mit Auswahl was passieren soll
async function tidyDialog() {
  const doc = currentDoc();
  if (doc.kind === "block") return toast("Collegeblöcke werden nicht verarbeitet.");
  normalizeBlocks();
  const headings = allBlocks().filter((el) => /^H[12]$/.test(el.tagName)).length;
  const p = openModal(`
    <h3>✨ Blatt aufräumen</h3>
    <p class="lead">Macht das ganze Blatt ordentlicher – komplett kostenlos.</p>
    <label class="check-row"><input type="checkbox" id="tdSpell" checked> <span><b>Rechtschreibung &amp; Grammatik prüfen</b><small>Du siehst jede Korrektur vorher und kannst sie abwählen.</small></span></label>
    <label class="check-row"><input type="checkbox" id="tdTidy" checked> <span><b>Formatierung aufräumen</b><small>Doppelte Leerzeichen, Satzanfänge groß, „Anführungszeichen“, → Pfeile, Zeilen mit „-“ werden zu Listen, leere Zeilen weg.</small></span></label>
    <label class="check-row"><input type="checkbox" id="tdToc" ${headings >= 2 ? "" : "disabled"}> <span><b>Inhaltsübersicht oben einfügen</b><small>${
      headings >= 2 ? `Aus deinen ${headings} Überschriften.` : "Braucht mindestens 2 Überschriften."
    }</small></span></label>
    <div class="modal-actions"><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>Aufräumen</button></div>`);
  const m = openModal.lastModal;
  $("[data-x]", m).onclick = () => m.close(null);
  $("[data-ok]", m).onclick = () => m.close({ spelling: $("#tdSpell", m).checked, tidy: $("#tdTidy", m).checked, toc: $("#tdToc", m).checked });
  const opts = await p;
  if (opts) await improveBlocks(allBlocks(), opts);
}

async function improveBlocks(blocks, { spelling = true, tidy = true, toc = false } = {}) {
  const doc = currentDoc();
  normalizeBlocks();
  let matches = [];
  let spellFailed = false;
  if (spelling) {
    const busy = toast("Prüfe Rechtschreibung …", "", 60000);
    try {
      matches = await checkSpelling(textUnits(blocks));
    } catch {
      spellFailed = true;
    } finally {
      busy.remove();
    }
  }
  let chosen = [];
  if (matches.length) {
    chosen = await reviewCorrections(matches);
    if (chosen === null) return;
  }
  applyCorrections(chosen);
  const tidied = tidy ? tidyBlocks(blocks) : 0;
  if (toc) insertToc();
  normalizeBlocks();
  if (!spellFailed) {
    // Danach gilt das ganze Blatt als verbessert – gefragt wird erst nach der nächsten Änderung
    for (const el of allBlocks()) doc.improved[el.dataset.bid] = blockHash(el);
    doc.declinedSig = "";
  }
  doc.html = editorEl.innerHTML;
  doc.updatedAt = Date.now();
  await writeState();
  renderGlossary();
  resizeCanvas();
  updateSavedState();
  if (spellFailed) toast("Rechtschreibprüfung gerade nicht erreichbar (Internet?) – nur aufgeräumt.", "error", 5000);
  else if (!chosen.length && !tidied && !toc) toast("Alles sauber ✓");
  else toast(`✨ ${[chosen.length ? `${chosen.length} Korrektur(en)` : "", tidied ? `${tidied} Stelle(n) aufgeräumt` : "", toc ? "Übersicht eingefügt" : ""].filter(Boolean).join(" · ")}`);
}

// Zerlegt Blöcke in Texteinheiten: Absatz, Überschrift oder einzelner Listenpunkt
function textUnits(blocks) {
  const els = [];
  for (const b of blocks) {
    if (!b.isConnected) continue;
    if (/^(UL|OL)$/.test(b.tagName)) els.push(...b.querySelectorAll("li"));
    else els.push(b);
  }
  return els.map((el) => {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (el.tagName !== "LI" || n.parentElement.closest("li") === el) nodes.push(n);
    }
    return { el, nodes, text: nodes.map((n) => n.data).join("") };
  });
}

// Kostenlose Prüfung über LanguageTool (öffentlicher Dienst, keine Anmeldung)
async function checkSpelling(units) {
  const SEP = "\n\n";
  const found = [];
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const text = batch.map((u) => u.text).join(SEP);
    const res = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      body: new URLSearchParams({ text, language: "de-DE" }),
    });
    if (!res.ok) throw new Error("LanguageTool nicht erreichbar");
    const data = await res.json();
    let offset = 0;
    const starts = batch.map((u) => {
      const s = offset;
      offset += u.text.length + SEP.length;
      return s;
    });
    for (const m of data.matches || []) {
      if (!m.replacements?.length) continue;
      let i = starts.length - 1;
      while (i > 0 && starts[i] > m.offset) i--;
      const unit = batch[i];
      const start = m.offset - starts[i];
      const end = start + m.length;
      if (end > unit.text.length) continue;
      found.push({ unit, start, end, original: unit.text.slice(start, end), replacement: m.replacements[0].value, message: m.shortMessage || m.message });
    }
    batch = [];
    size = 0;
  };
  for (const u of units) {
    if (!u.text.trim()) continue;
    if (size + u.text.length > 15000) await flush();
    batch.push(u);
    size += u.text.length + SEP.length;
  }
  await flush();
  // Rot markierte Fachbegriffe nie „korrigieren“
  return found.filter((m) => {
    const loc = locateText(m.unit, m.start, m.end);
    return loc && !loc.node.parentElement.closest("span.term");
  });
}

function locateText(unit, start, end) {
  let pos = 0;
  for (const node of unit.nodes) {
    const len = node.data.length;
    if (start >= pos && end <= pos + len) return { node, offset: start - pos };
    pos += len;
  }
  return null;
}

function reviewCorrections(matches) {
  const snippet = (m) => {
    const t = m.unit.text;
    const from = Math.max(0, m.start - 25);
    const to = Math.min(t.length, m.end + 25);
    return `${from ? "…" : ""}${esc(t.slice(from, m.start))}<mark>${esc(m.original)}</mark>${esc(t.slice(m.end, to))}${to < t.length ? "…" : ""}`;
  };
  const p = openModal(
    `
    <h3>Korrekturvorschläge (${matches.length})</h3>
    <p class="lead">Abwählen, was nicht geändert werden soll.</p>
    <div class="corr-list">${matches
      .map(
        (m, i) => `<label class="check-row"><input type="checkbox" data-i="${i}" checked>
        <span><b><s>${esc(m.original) || "␣"}</s> → ${esc(m.replacement) || "(löschen)"}</b><small>${esc(m.message)}</small><small class="ctx">${snippet(m)}</small></span></label>`
      )
      .join("")}</div>
    <div class="modal-actions"><button class="btn left" data-none>Keine</button><button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>Übernehmen</button></div>`,
    { wide: true }
  );
  const m = openModal.lastModal;
  $("[data-none]", m).onclick = () => $$("[data-i]", m).forEach((c) => (c.checked = false));
  $("[data-x]", m).onclick = () => m.close(null);
  $("[data-ok]", m).onclick = () => m.close($$("[data-i]", m).filter((c) => c.checked).map((c) => matches[Number(c.dataset.i)]));
  return p;
}

function applyCorrections(chosen) {
  // Pro Texteinheit von hinten nach vorne, damit die Positionen stimmen
  const byUnit = new Map();
  for (const m of chosen) byUnit.set(m.unit, [...(byUnit.get(m.unit) || []), m]);
  for (const [unit, list] of byUnit) {
    for (const m of list.sort((a, b) => b.start - a.start)) {
      const loc = locateText(unit, m.start, m.end);
      if (!loc) continue;
      const d = loc.node.data;
      loc.node.data = d.slice(0, loc.offset) + m.replacement + d.slice(loc.offset + m.end - m.start);
    }
  }
}

const tidyString = (s) =>
  s
    .replace(/(\S)[ \u00a0]{2,}/g, "$1 ")
    .replace(/[ \u00a0]+([,.;:!?])/g, "$1")
    .replace(/\.{3}/g, "…")
    .replace(/<->/g, "↔")
    .replace(/->/g, "→")
    .replace(/=>/g, "⇒")
    .replace(/<-/g, "←")
    .replace(/"([^"\n]+)"/g, "„$1“");

// Regelbasiertes Aufräumen – gibt zurück, wie viele Blöcke sich geändert haben
function tidyBlocks(blocks) {
  const bids = new Set(blocks.map((b) => b.dataset.bid));
  const before = new Map(allBlocks().map((el) => [el.dataset.bid, el.innerHTML]));

  for (const unit of textUnits(blocks)) {
    for (const n of unit.nodes) {
      const t = tidyString(n.data);
      if (t !== n.data) n.data = t;
    }
    if (unit.nodes.length) {
      const first = unit.nodes.find((n) => n.data.trim());
      if (first) first.data = first.data.replace(/^\s+/, "");
      const last = unit.nodes[unit.nodes.length - 1];
      last.data = last.data.replace(/\s+$/, "");
      if (first && /^(P|H1|H2|H3)$/.test(unit.el.tagName)) first.data = first.data.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
    }
  }

  const els = () => allBlocks().filter((el) => bids.has(el.dataset.bid));
  // Zeilen mit „- “ / „• “ / „1. “ werden zu echten Listen
  const listType = (el) => {
    if (el.tagName !== "P") return null;
    const t = el.textContent;
    if (/^\s*[-–•*]\s+\S/.test(t)) return "ul";
    if (/^\s*\d+[.)]\s+\S/.test(t)) return "ol";
    return null;
  };
  let list = null;
  for (const el of els()) {
    const type = listType(el);
    if (!type) {
      list = null;
      continue;
    }
    const firstText = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    if (firstText) firstText.data = firstText.data.replace(/^\s*(?:[-–•*]|\d+[.)])\s+/, "");
    const li = document.createElement("li");
    li.append(...el.childNodes);
    if (list && list.tagName.toLowerCase() === type && list.nextElementSibling === el) {
      list.appendChild(li);
      el.remove();
    } else {
      list = document.createElement(type);
      list.dataset.bid = el.dataset.bid;
      list.appendChild(li);
      el.replaceWith(list);
    }
  }
  // Kurze Zeile mit „:“ direkt vor einer Liste wird zur Zwischenüberschrift
  for (const el of els()) {
    const t = el.textContent.trim();
    const next = el.nextElementSibling;
    if (el.tagName === "P" && /:$/.test(t) && t.length <= 60 && !/[.!?]\s/.test(t) && next && /^(UL|OL)$/.test(next.tagName) && !el.querySelector("b, strong")) {
      const h = document.createElement("h3");
      h.textContent = t.replace(/:$/, "");
      h.dataset.bid = el.dataset.bid;
      el.replaceWith(h);
    }
  }
  // Mehrere leere Zeilen hintereinander → eine
  for (const el of allBlocks()) {
    const empty = (x) => x && x.tagName === "P" && !x.textContent.trim() && !x.querySelector("span");
    if (empty(el) && (empty(el.previousElementSibling) || !el.nextElementSibling)) el.remove();
  }

  let changed = 0;
  for (const el of allBlocks()) if (before.get(el.dataset.bid) !== el.innerHTML) changed++;
  return changed;
}

function insertToc() {
  $$("[data-toc]", editorEl).forEach((el) => el.remove());
  const heads = allBlocks().filter((h) => /^H[12]$/.test(h.tagName) && h.textContent.trim());
  if (heads.length < 2) return;
  const title = document.createElement("h3");
  title.textContent = "Inhalt";
  title.dataset.toc = "1";
  const ul = document.createElement("ul");
  ul.dataset.toc = "1";
  for (const h of heads) {
    const li = document.createElement("li");
    li.textContent = h.textContent.trim();
    if (h.tagName === "H2") li.style.marginLeft = "18px";
    ul.appendChild(li);
  }
  const host = isPdf(currentDoc()) ? containers().sort((a, b) => a.dataset.y - b.dataset.y)[0] : editorEl;
  host?.prepend(title, ul);
}

// ---------- Fachbegriffe ----------

// Seriöse Nachschlagewerke statt automatischer Texte
const TERM_SOURCES = [
  ["Duden", (t) => `https://www.duden.de/suchen/dudenonline/${encodeURIComponent(t)}`],
  ["DWDS", (t) => `https://www.dwds.de/wb/${encodeURIComponent(t)}`],
  ["Gabler", (t) => `https://www.google.com/search?q=${encodeURIComponent(t + " site:wirtschaftslexikon.gabler.de")}`],
  ["Spektrum", (t) => `https://www.google.com/search?q=${encodeURIComponent(t + " site:spektrum.de/lexikon")}`],
  ["bpb", (t) => `https://www.google.com/search?q=${encodeURIComponent(t + " site:bpb.de")}`],
  ["Scholar", (t) => `https://scholar.google.de/scholar?q=${encodeURIComponent(t)}`],
  ["Wikipedia", (t) => `https://de.wikipedia.org/w/index.php?search=${encodeURIComponent(t)}`],
];

// Gleicher Begriff schon in einem anderen Blatt erklärt? Dann übernehmen.
function findExplanation(key, doc) {
  const others = semDocs()
    .filter((d) => d.id !== doc.id && d.glossary?.[key]?.explanation)
    .sort((a, b) => (b.moduleId === doc.moduleId) - (a.moduleId === doc.moduleId) || b.updatedAt - a.updatedAt);
  return others[0] ? { explanation: others[0].glossary[key].explanation, from: others[0].title } : null;
}

function renderGlossary() {
  const box = $("#glossary");
  if (!box) return;
  const doc = currentDoc();
  const terms = termsInDoc().sort((a, b) => a.localeCompare(b, "de"));
  if (!terms.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if ($(".gl-text:focus", box)) return; // nicht beim Tippen neu aufbauen
  for (const t of terms) {
    const key = t.toLowerCase();
    if (!doc.glossary[key]?.explanation) {
      const other = findExplanation(key, doc);
      if (other) doc.glossary[key] = { term: t, ...other };
    }
  }
  box.innerHTML = `
    <h4>Fachbegriffe</h4>
    <dl>${terms
      .map((t) => {
        const g = doc.glossary[t.toLowerCase()];
        return `<dt class="term-name">${esc(t)}</dt><dd>
          <div class="gl-text" contenteditable="true" spellcheck="true" lang="de" data-key="${esc(t.toLowerCase())}" data-term="${esc(t)}" data-placeholder="Erklärung eintippen …">${esc(g?.explanation || "")}</div>
          <div class="gl-meta">${g?.from ? `<span>aus „${esc(g.from)}“ übernommen · </span>` : ""}nachschlagen: ${TERM_SOURCES.map(
            ([name, url]) => `<a href="${esc(url(t))}" target="_blank" rel="noopener">${name}</a>`
          ).join(" · ")}</div></dd>`;
      })
      .join("")}</dl>`;
  $$(".gl-text", box).forEach((el) => {
    el.addEventListener("input", () => {
      doc.glossary[el.dataset.key] = { term: el.dataset.term, explanation: el.innerText.trim() };
      doc.updatedAt = Date.now();
      persist();
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    });
    el.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), el.blur()));
  });
}

async function toolbarAction(a) {
  if (a === "back") {
    await leaveEditor();
    renderAll();
  }
  if (a === "save") saveDoc({ ask: true });
  if (a === "tidy") tidyDialog();
  if (a === "focus") toggleFocus();
  if (a === "design") {
    ui.panel = ui.panel === "design" ? (currentDoc().mode === "task" ? "task" : null) : "design";
    renderSidePanel();
  }
  if (a === "export") {
    normalizeBlocks();
    exportDialog([currentDoc()], currentDoc().title);
  }
}

// Beim Verlassen wird gespeichert – und wie beim Speichern einmal gefragt
async function leaveEditor() {
  if (ui.view !== "editor" || !currentDoc()) return;
  const doc = currentDoc();
  if (!editorEl.textContent.trim() && !floatEl.textContent.trim() && !sheetEl.querySelector("img") && !doc.strokes.length && doc.title === `${KINDS[doc.kind].label} ${fmtShort(doc.createdAt)}`) {
    state.docs = state.docs.filter((d) => d.id !== doc.id); // leeres Blatt nicht aufheben
    await writeState();
  } else {
    await saveDoc({ ask: true });
  }
  resizeObs?.disconnect();
  fitObs?.disconnect();
  document.removeEventListener("selectionchange", rememberSelection);
  $$(".pop").forEach((p) => p.remove());
  $("#selBar")?.setAttribute("hidden", "");
  editorEl = floatEl = sheetEl = canvasEl = null;
  activeBox = activeImg = null;
  lastPages = 0;
  ui.view = "files";
  if (moduleById(doc.moduleId) || doc.moduleId === null) ui.loc = { moduleId: doc.moduleId, folderId: doc.folderId };
}

// ---------- Stift, Formen & Lasso ----------

const SHAPES = [
  ["line", "／ Linie"],
  ["arrow", "→ Pfeil"],
  ["rect", "▭ Rechteck"],
  ["ellipse", "◯ Kreis"],
  ["triangle", "△ Dreieck"],
];

function renderPenBar(bar) {
  const pen = ui.pen;
  pen.shape ||= "line";
  const colors = pen.kind === "marker" ? MARKER_COLORS : PEN_COLORS;
  const usesColor = !["eraser", "lasso"].includes(pen.kind);
  if (usesColor && !colors.includes(pen.color) && !pen.customColor) pen.color = colors[0];
  bar.innerHTML = `
    <div class="seg">
      <button data-pen="pen" class="${pen.kind === "pen" ? "on" : ""}">✎ Stift</button>
      <button data-pen="marker" class="${pen.kind === "marker" ? "on" : ""}">▮ Marker</button>
      <button data-pen="shape" class="${pen.kind === "shape" ? "on" : ""}">△ Formen</button>
      <button data-pen="eraser" class="${pen.kind === "eraser" ? "on" : ""}">🧽 Radiergummi</button>
      <button data-pen="lasso" class="${pen.kind === "lasso" ? "on" : ""}" title="Gemaltes einkreisen und verschieben">✨ Magic Stift</button>
    </div>
    ${
      pen.kind === "pen"
        ? `<span class="divider"></span>${PEN_TOOLS.map(([k, l]) => `<button class="chip ${pen.tool === k ? "on" : ""}" data-tool-type="${k}">${l}</button>`).join("")}
      <button class="chip ${pen.autoShape ? "on" : ""}" id="autoShape" title="Gerade Striche und Pfeile automatisch sauber machen">📐 Auto-Form</button>`
        : ""
    }
    ${
      pen.kind === "eraser"
        ? `<span class="divider"></span><button class="chip ${pen.eraseMode === "stroke" ? "on" : ""}" data-erase="stroke">Ganze Striche</button><button class="chip ${pen.eraseMode === "pixel" ? "on" : ""}" data-erase="pixel">Genau radieren</button>`
        : ""
    }
    ${pen.kind === "shape" ? `<span class="divider"></span>${SHAPES.map(([k, l]) => `<button class="chip ${pen.shape === k ? "on" : ""}" data-shape="${k}">${l}</button>`).join("")}` : ""}
    ${
      pen.kind === "lasso"
        ? `<span class="hint">Gemaltes einkreisen, dann die Auswahl an die neue Stelle ziehen. Gelöscht wird hier nichts.</span>`
        : `<span class="divider"></span>
      <span title="Dicke">Dicke</span>
      ${pen.kind === "eraser" && pen.eraseMode === "stroke" ? "" : `<input type="range" id="penWidth" min="1" max="${pen.kind === "marker" || pen.kind === "eraser" ? 40 : 12}" value="${pen.width}">`}
      <span class="width-dot" id="widthDot"></span>
      ${
        usesColor
          ? `<span class="divider"></span>${colors.map((c) => `<button class="swatch ${c === pen.color ? "on" : ""}" style="background:${c}" data-pcolor="${c}"></button>`).join("")}
      <label class="swatch rainbow" title="Alle Farben"><input type="color" id="customPen"></label>`
          : ""
      }`
    }
    <span class="divider"></span>
    <button class="tb" data-p="undo" title="Letzten Strich entfernen">↶ Strich</button>
    <button class="tb" data-p="clear" title="Alle Zeichnungen löschen">🗑 Alles</button>`;
  const dot = $("#widthDot", bar);
  const updDot = () => {
    if (!dot) return;
    const w = Math.max(3, Math.min(30, pen.width));
    Object.assign(dot.style, { width: w + "px", height: w + "px", color: pen.kind === "eraser" ? "#aeaeb2" : pen.color });
  };
  updDot();
  $$("[data-pen]", bar).forEach(
    (b) =>
      (b.onclick = () => {
        pen.kind = b.dataset.pen;
        pen.customColor = false;
        pen.width = { pen: 3, marker: 16, eraser: 20, shape: 3 }[pen.kind] || 3;
        clearLasso();
        renderSubbar();
      })
  );
  $$("[data-tool-type]", bar).forEach(
    (b) =>
      (b.onclick = () => {
        pen.tool = b.dataset.toolType;
        pen.width = PEN_TOOLS.find(([k]) => k === pen.tool)[2];
        renderSubbar();
      })
  );
  $("#autoShape", bar)?.addEventListener("click", () => {
    pen.autoShape = !pen.autoShape;
    localStorage.setItem("nh-autoshape", pen.autoShape ? "1" : "0");
    renderSubbar();
  });
  $$("[data-erase]", bar).forEach(
    (b) =>
      (b.onclick = () => {
        pen.eraseMode = b.dataset.erase;
        renderSubbar();
      })
  );
  $$("[data-shape]", bar).forEach(
    (b) =>
      (b.onclick = () => {
        pen.shape = b.dataset.shape;
        renderSubbar();
      })
  );
  $("#penWidth", bar)?.addEventListener("input", (e) => {
    pen.width = Number(e.target.value);
    updDot();
  });
  $$("[data-pcolor]", bar).forEach(
    (b) =>
      (b.onclick = () => {
        pen.color = b.dataset.pcolor;
        pen.customColor = false;
        renderSubbar();
      })
  );
  $("#customPen", bar)?.addEventListener("input", (e) => {
    const hex = e.target.value;
    if (pen.kind === "marker") {
      const n = parseInt(hex.slice(1), 16);
      pen.color = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0.4)`;
    } else pen.color = hex;
    pen.customColor = true;
    e.target.parentElement.style.setProperty("--picked", hex);
    $$(".swatch.on", bar).forEach((s) => s.classList.remove("on"));
    updDot();
  });
  $("[data-p=undo]", bar).onclick = () => {
    currentDoc().strokes.pop();
    clearLasso();
    redrawCanvas();
    touchDoc();
  };
  $("[data-p=clear]", bar).onclick = async () => {
    if (await confirmModal("Zeichnungen löschen?", "Alle Stiftstriche und Formen auf diesem Blatt werden entfernt.", "Löschen", { danger: true })) {
      currentDoc().strokes = [];
      clearLasso();
      redrawCanvas();
      touchDoc();
    }
  };
}

let lasso = null; // { idx: [...], bbox: [x1,y1,x2,y2] } in normierten Koordinaten

function clearLasso() {
  lasso = null;
  const bar = $("#lassoBar");
  if (bar) bar.hidden = true;
  if (canvasEl) redrawCanvas();
}

// Punkte, die eine Form ausmachen (für Lasso-Auswahl)
function strokePoints(s) {
  if (s.kind !== "shape") return s.points;
  const [[x1, y1], [x2, y2]] = s.points;
  const pts = [];
  for (let t = 0; t <= 1; t += 0.125) pts.push([x1 + (x2 - x1) * t, y1], [x1 + (x2 - x1) * t, y2], [x1, y1 + (y2 - y1) * t], [x2, y1 + (y2 - y1) * t]);
  return s.shape === "line" || s.shape === "arrow" ? [0, 0.25, 0.5, 0.75, 1].map((t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]) : pts;
}

function insidePoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bboxOf(strokes) {
  const pts = strokes.flatMap(strokePoints);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function showLassoBar() {
  const bar = $("#lassoBar");
  if (!lasso || !bar) return;
  const W = SHEET_BASE_WIDTH;
  bar.hidden = false;
  bar.style.left = Math.max(0, lasso.bbox[0] * W) + "px";
  bar.style.top = Math.max(0, lasso.bbox[1] * W - 46) + "px";
}

function setupCanvas() {
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(() => resizeCanvas());
  resizeObs.observe(sheetEl);
  resizeCanvas();

  let current = null;
  let lassoPath = null;
  let moving = null;
  let erasing = false;
  let sawPen = false;
  const pointFrom = (e) => {
    const rect = sheetEl.getBoundingClientRect();
    const W = rect.width;
    return [(e.clientX - rect.left) / W, (e.clientY - rect.top) / W];
  };
  const ctx = () => canvasEl.getContext("2d");


  const startDraw = (e) => {
    if (e.pointerType === "pen") sawPen = true;
    if (e.pointerType === "touch" && sawPen) return; // Handballen ignorieren
    e.preventDefault();
    try {
      sheetEl.setPointerCapture(e.pointerId);
    } catch {}
    const pt = pointFrom(e);
    const { kind, color, width, shape } = ui.pen;
    if (kind === "lasso") {
      const [x1, y1, x2, y2] = lasso?.bbox || [];
      if (lasso && pt[0] >= x1 - 0.01 && pt[0] <= x2 + 0.01 && pt[1] >= y1 - 0.01 && pt[1] <= y2 + 0.01) {
        moving = { start: pt, orig: lasso.idx.map((i) => currentDoc().strokes[i].points.map((p) => [...p])), bbox: [...lasso.bbox] };
        $("#lassoBar").hidden = true;
      } else {
        clearLasso();
        lassoPath = [pt];
      }
      return;
    }
    if (kind === "shape") {
      current = { kind: "shape", shape, color, width, points: [pt, pt] };
      return;
    }
    if (kind === "eraser" && ui.pen.eraseMode === "stroke") {
      erasing = true;
      eraseAt(pt);
      return;
    }
    current = { kind, color: kind === "eraser" ? "#000" : color, width, points: [[...pt, e.pressure || 0.5]] };
    if (kind === "pen") current.tool = ui.pen.tool;
    if (kind === "pen" && e.pointerType === "pen") current.pressure = true;
    drawStroke(ctx(), current, sheetEl.clientWidth);
  };
  canvasEl.addEventListener("pointerdown", (e) => ui.tool === "pen" && startDraw(e));
  // Apple Pencil zeichnet immer – auch im Schreib-Modus. Finger & Tastatur schreiben weiter.
  sheetEl.addEventListener(
    "pointerdown",
    (e) => {
      if (ui.tool !== "text" || e.pointerType !== "pen" || state.settings.pencilDraws === false) return;
      if (e.target.closest(".box-tools, .float-bar, .sel-bar, .doc-title")) return;
      e.stopPropagation();
      startDraw(e);
    },
    true
  );

  sheetEl.addEventListener("pointermove", (e) => {
    const pt = pointFrom(e);
    const W = sheetEl.clientWidth;
    if (lassoPath) {
      lassoPath.push(pt);
      redrawCanvas();
      const c = ctx();
      c.save();
      c.setLineDash([6, 5]);
      c.strokeStyle = "#007aff";
      c.lineWidth = 1.5;
      c.beginPath();
      lassoPath.forEach(([x, y], i) => (i ? c.lineTo(x * W, y * W) : c.moveTo(x * W, y * W)));
      c.stroke();
      c.restore();
      return;
    }
    if (erasing) return eraseAt(pt);
    if (moving) {
      const dx = pt[0] - moving.start[0];
      const dy = pt[1] - moving.start[1];
      const strokes = currentDoc().strokes;
      lasso.idx.forEach((i, k) => (strokes[i].points = moving.orig[k].map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])));
      lasso.bbox = [moving.bbox[0] + dx, moving.bbox[1] + dy, moving.bbox[2] + dx, moving.bbox[3] + dy];
      redrawCanvas();
      return;
    }
    if (!current) return;
    if (current.kind === "shape") {
      current.points[1] = pt;
      redrawCanvas();
      drawStroke(ctx(), current, W);
      return;
    }
    current.points.push([...pt, e.pressure || 0.5]);
    drawSegment(ctx(), current, W, current.points.length - 2);
  });

  const end = () => {
    if (lassoPath) {
      const strokes = currentDoc().strokes;
      const idx = lassoPath.length > 3 ? strokes.map((s, i) => [s, i]).filter(([s]) => {
        const pts = strokePoints(s);
        return pts.filter((p) => insidePoly(p, lassoPath)).length >= pts.length / 2;
      }).map(([, i]) => i) : [];
      lassoPath = null;
      if (idx.length) {
        lasso = { idx, bbox: bboxOf(idx.map((i) => strokes[i])) };
        showLassoBar();
      }
      redrawCanvas();
      return;
    }
    if (erasing) {
      erasing = false;
      touchDoc();
      return;
    }
    if (moving) {
      moving = null;
      showLassoBar();
      touchDoc();
      return;
    }
    if (!current) return;
    const [a, b] = [current.points[0], current.points[current.points.length - 1]];
    if (current.kind === "pen" && ui.pen.autoShape) {
      // Gerade Striche & Pfeile automatisch sauber machen (läuft komplett auf dem Gerät)
      const strokes = currentDoc().strokes;
      const res = recognizeShape(current, strokes[strokes.length - 1]);
      if (res?.replacePrev) strokes.pop();
      if (res) current = res.stroke;
      if (res?.drop) current = null;
    }
    if (current && (current.kind !== "shape" || Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.005)) currentDoc().strokes.push(current);
    current = null;
    redrawCanvas();
    touchDoc();
  };
  sheetEl.addEventListener("pointerup", end);
  sheetEl.addEventListener("pointercancel", end);
}

// Ganze Striche entfernen, die der Radiergummi berührt
function eraseAt(pt) {
  const doc = currentDoc();
  const r = 10 / SHEET_BASE_WIDTH;
  const before = doc.strokes.length;
  doc.strokes = doc.strokes.filter((s) => {
    const pts = strokeOutline(s);
    if (pts.length === 1) return Math.hypot(pts[0][0] - pt[0], pts[0][1] - pt[1]) > r + s.width / SHEET_BASE_WIDTH / 2;
    for (let i = 1; i < pts.length; i++) if (segDist(pt, pts[i - 1], pts[i]) <= r + s.width / SHEET_BASE_WIDTH / 2) return false;
    return true;
  });
  if (doc.strokes.length !== before) redrawCanvas();
}

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Umriss einer Form als Linienzug (für Radiergummi)
function strokeOutline(s) {
  if (s.kind !== "shape") return s.points;
  const [[x1, y1], [x2, y2]] = s.points;
  if (s.shape === "rect") return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
  if (s.shape === "triangle") return [[(x1 + x2) / 2, y1], [x2, y2], [x1, y2], [(x1 + x2) / 2, y1]];
  if (s.shape === "ellipse") {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    return Array.from({ length: 33 }, (_, i) => [cx + (Math.abs(x2 - x1) / 2) * Math.cos((i / 32) * 2 * Math.PI), cy + (Math.abs(y2 - y1) / 2) * Math.sin((i / 32) * 2 * Math.PI)]);
  }
  return [[x1, y1], [x2, y2]];
}

// Linienzug vereinfachen (Ramer-Douglas-Peucker)
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const angleAt = (a, b, c) => {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  return (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)))) * 180) / Math.PI;
};

// Erkennt gerade Striche und Pfeile. Kurze Striche (Buchstaben) bleiben, wie sie sind.
function recognizeShape(stroke, prev) {
  const W = SHEET_BASE_WIDTH;
  const pts = stroke.points.map(([x, y]) => [x * W, y * W]);
  if (pts.length < 3) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const a = pts[0];
  const b = pts[pts.length - 1];
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const norm = (p) => [p[0] / W, p[1] / W];
  const asShape = (shape, p1, p2) => ({ kind: "shape", shape, color: stroke.color, width: stroke.width, points: [norm(p1), norm(p2)] });

  // 1) Gerader Strich
  if (chord >= 40 && chord / len > 0.92 && Math.max(...pts.map((p) => segDist(p, a, b))) < Math.max(5, chord * 0.06)) {
    return { stroke: asShape("line", a, b) };
  }

  const v = simplify(pts, Math.max(5, len * 0.04));
  // 2) Pfeil in einem Zug: langer Schaft, danach kurze Spitze, die zurück zeigt
  if (v.length >= 3 && v.length <= 5) {
    const [A, B, C] = v;
    const shaft = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nearHead = v.slice(2).every((p) => Math.hypot(p[0] - B[0], p[1] - B[1]) < shaft * 0.5);
    if (shaft >= 45 && shaft >= len * 0.5 && nearHead && angleAt(A, B, C) < 75) return { stroke: asShape("arrow", A, B) };
  }

  // 3) Spitze nachträglich gemalt: kurzes „V“ am Ende einer geraden Linie
  if (v.length === 3 && prev?.kind === "shape" && prev.shape === "line") {
    const [P, Q, R] = v;
    const arms = [Math.hypot(P[0] - Q[0], P[1] - Q[1]), Math.hypot(R[0] - Q[0], R[1] - Q[1])];
    const [l1, l2] = prev.points.map(([x, y]) => [x * W, y * W]);
    if (arms.every((d) => d > 6 && d < 70) && angleAt(P, Q, R) < 120) {
      for (const [tip, tail] of [[l2, l1], [l1, l2]]) {
        // Spitze am Linienende, Schenkel zeigen zurück Richtung Linie
        if (Math.hypot(Q[0] - tip[0], Q[1] - tip[1]) < 25 && angleAt(tail, tip, [(P[0] + R[0]) / 2, (P[1] + R[1]) / 2]) < 60) {
          return { stroke: { ...prev, shape: "arrow", points: [norm(tail), norm(tip)] }, replacePrev: true };
        }
      }
    }
  }
  return null;
}

function resizeCanvas(force = false) {
  if (!canvasEl || !sheetEl) return;
  const ratio = (window.devicePixelRatio || 1) * sheetScale;
  const w = sheetEl.clientWidth;
  const h = sheetEl.offsetHeight;
  if (force || canvasEl.width !== Math.round(w * ratio) || canvasEl.height !== Math.round(h * ratio)) {
    canvasEl.width = Math.round(w * ratio);
    canvasEl.height = Math.round(h * ratio);
    canvasEl.style.width = w + "px";
    canvasEl.style.height = h + "px";
    redrawCanvas();
  }
}

function redrawCanvas() {
  if (!canvasEl) return;
  const c = canvasEl.getContext("2d");
  const ratio = (window.devicePixelRatio || 1) * sheetScale;
  const W = sheetEl.clientWidth;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, canvasEl.width, canvasEl.height);
  const strokes = currentDoc().strokes;
  strokes.forEach((s, i) => {
    if (lasso?.idx.includes(i)) {
      c.save();
      c.shadowColor = "rgba(0,122,255,0.9)";
      c.shadowBlur = 6;
      drawStroke(c, s, W);
      c.restore();
    } else drawStroke(c, s, W);
  });
  if (lasso) {
    const [x1, y1, x2, y2] = lasso.bbox.map((v) => v * W);
    c.save();
    c.setLineDash([6, 5]);
    c.strokeStyle = "#007aff";
    c.lineWidth = 1.2;
    c.strokeRect(x1 - 6, y1 - 6, x2 - x1 + 12, y2 - y1 + 12);
    c.restore();
  }
}

// Körnige Struktur für Bleistift & Buntstift
const grainCache = new Map();
function grain(color, tool) {
  const key = color + tool;
  if (!grainCache.has(key)) {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const g = c.getContext("2d");
    g.fillStyle = color;
    // Grundfarbe + Körnung → sieht aus wie Graphit / Wachsstift auf Papier
    g.globalAlpha = tool === "pencil" ? 0.55 : 0.7;
    g.fillRect(0, 0, 48, 48);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (tool === "pencil" ? 900 : 1300); i++) {
      g.globalAlpha = 0.35 + rnd() * 0.65;
      g.fillRect(Math.floor(rnd() * 48), Math.floor(rnd() * 48), 1, 1);
    }
    grainCache.set(key, c);
  }
  return grainCache.get(key);
}

// Füller: Strichbreite je nach Druck (Apple Pencil) oder Tempo
function segWidth(s, i, W) {
  const base = (s.width * W) / SHEET_BASE_WIDTH;
  if (s.tool !== "fountain") return base;
  const a = s.points[i - 1] || s.points[i];
  const b = s.points[i];
  if (s.pressure) return base * (0.3 + 1.2 * ((a[2] + b[2]) / 2));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * SHEET_BASE_WIDTH;
  return base * Math.max(0.45, Math.min(1.35, 1.35 - len / 18));
}

function strokeStyle(ctx, s, W) {
  ctx.globalCompositeOperation = s.kind === "eraser" ? "destination-out" : s.kind === "marker" ? "multiply" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = s.color;
  if (s.tool === "pencil" || s.tool === "crayon") {
    ctx.strokeStyle = ctx.fillStyle = ctx.createPattern(grain(s.color, s.tool), "repeat");
    ctx.globalAlpha = s.tool === "pencil" ? 0.85 : 0.95;
  }
  ctx.lineWidth = ((s.tool === "pencil" ? 0.8 : 1) * s.width * W) / SHEET_BASE_WIDTH;
  ctx.lineCap = s.kind === "marker" ? "butt" : "round";
  ctx.lineJoin = "round";
}

function drawShape(ctx, s, W) {
  const [[x1, y1], [x2, y2]] = s.points.map(([x, y]) => [x * W, y * W]);
  ctx.beginPath();
  if (s.shape === "rect") ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  else if (s.shape === "ellipse") ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
  else if (s.shape === "triangle") {
    ctx.moveTo((x1 + x2) / 2, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x1, y2);
    ctx.closePath();
  } else {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (s.shape === "arrow") {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.max(10, ctx.lineWidth * 4);
      for (const d of [-0.45, 0.45]) {
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(ang + d), y2 - len * Math.sin(ang + d));
      }
    }
  }
  ctx.stroke();
}

function drawStroke(ctx, s, W) {
  ctx.save();
  strokeStyle(ctx, s, W);
  if (s.kind === "shape") {
    drawShape(ctx, s, W);
    ctx.restore();
    return;
  }
  const pts = s.points.map(([x, y]) => [x * W, y * W]);
  if (s.tool === "fountain" && pts.length > 1) {
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = segWidth(s, i, W);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
      ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSegment(ctx, s, W, i) {
  if (s.kind === "marker") {
    // Marker live komplett neu zeichnen, sonst entstehen dunkle Überlappungen
    redrawCanvas();
    drawStroke(ctx, s, W);
    return;
  }
  ctx.save();
  strokeStyle(ctx, s, W);
  const [a, b] = [s.points[i], s.points[i + 1]];
  if (s.tool === "fountain") ctx.lineWidth = segWidth(s, i + 1, W);
  ctx.beginPath();
  ctx.moveTo(a[0] * W, a[1] * W);
  ctx.lineTo(b[0] * W, b[1] * W);
  ctx.stroke();
  ctx.restore();
}

// Zeichnungen einer Seite als Bild (für den Export)
function renderStrokesForPage(doc, page) {
  if (!doc.strokes?.length) return null;
  const W = SHEET_BASE_WIDTH;
  const top = page * STRIDE;
  const onPage = doc.strokes.some((s) => strokePoints(s).some(([, y]) => y * W >= top - 40 && y * W <= top + PAGE_H + 40));
  if (!onPage) return null;
  const c = document.createElement("canvas");
  c.width = W * 2;
  c.height = PAGE_H * 2;
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);
  ctx.translate(0, -top);
  for (const s of doc.strokes) drawStroke(ctx, s, W);
  return c.toDataURL("image/png");
}

// ---------- Rechte Seitenleiste: Aufgaben-Vorlagen & Design ----------

// Typische Antwortformen in Seminaren – jeweils als Schablone zum Ausfüllen
const ANSWER_FORMS = {
  bullets: { label: "Stichpunkte", ico: "•", html: `<ul><li><br></li></ul>` },
  text: { label: "Fließtext", ico: "¶", html: `<p><br></p>` },
  definition: { label: "Definition", ico: "📖", html: `<p><b>Begriff:</b>&nbsp;</p><p><b>Definition:</b>&nbsp;</p><p><b>Merkmale:</b></p><ul><li><br></li></ul><p><b>Beispiel:</b>&nbsp;</p>` },
  discussion: {
    label: "Erörterung",
    ico: "⚖️",
    html: `<p><b>Fragestellung / These:</b>&nbsp;</p><p><b>Pro:</b></p><ul><li><br></li></ul><p><b>Contra:</b></p><ul><li><br></li></ul><p><b>Abwägung &amp; Fazit:</b>&nbsp;</p>`,
  },
  analysis: {
    label: "Textanalyse",
    ico: "🔍",
    html: `<p><b>Autor:in, Titel, Jahr:</b>&nbsp;</p><p><b>Thema &amp; Kernaussage:</b>&nbsp;</p><p><b>Argumentation / Aufbau:</b></p><ul><li><br></li></ul><p><b>Eigene Einordnung:</b>&nbsp;</p>`,
  },
  comparison: {
    label: "Vergleich",
    ico: "↔️",
    html: `<p><b>Vergleichskriterien:</b>&nbsp;</p><p><b>Gemeinsamkeiten:</b></p><ul><li><br></li></ul><p><b>Unterschiede:</b></p><ul><li><br></li></ul><p><b>Fazit:</b>&nbsp;</p>`,
  },
  opinion: {
    label: "Stellungnahme",
    ico: "💬",
    html: `<p><b>Meine Position:</b>&nbsp;</p><p><b>Begründung:</b></p><ul><li><br></li></ul><p><b>Beleg / Beispiel:</b>&nbsp;</p><p><b>Fazit:</b>&nbsp;</p>`,
  },
  calc: { label: "Rechnung", ico: "🧮", html: `<p><b>Gegeben:</b>&nbsp;</p><p><b>Gesucht:</b>&nbsp;</p><p><b>Lösungsweg:</b></p><ul><li><br></li></ul><p><b>Ergebnis:</b>&nbsp;</p>` },
};

// Operatoren aus der Aufgabenstellung erkennen (wie in Seminaren & Klausuren üblich)
const OPERATORS = [
  [/\bnehmen sie stellung|stellung nehmen|\bbeurteil|\bbewert|\bpositionier/, "opinion", "Beurteilen / Stellung nehmen: ein eigenes, begründetes Urteil fällen."],
  [/\berörter|\bdiskutier|setzen sie sich .*auseinander/, "discussion", "Erörtern: Pro und Contra abwägen und zu einem begründeten Fazit kommen."],
  [/\bvergleich|gegenüberstell|\bgrenzen sie|\babgrenz/, "comparison", "Vergleichen: Gemeinsamkeiten und Unterschiede nach Kriterien herausarbeiten."],
  [/\bdefinier|\bbegriff.*bestimm/, "definition", "Definieren: Begriff genau bestimmen und Merkmale nennen."],
  [/\banalysier|\buntersuch|fassen sie .*zusammen|\bzusammenfass|arbeiten sie .*heraus|\bherausarbeit/, "analysis", "Analysieren: Text systematisch auf Aussage und Argumentation untersuchen."],
  [/\bberechn|\bermittel|\brechnen sie/, "calc", "Berechnen: Lösungsweg nachvollziehbar darstellen."],
  [/\bnenne|\bzählen sie|\baufzähl|\bliste|\bsammel|\bstichpunkt/, "bullets", "Nennen / Aufzählen: Aspekte knapp in Stichpunkten, ohne lange Erklärung."],
  [/\berläuter|\berklär|\bbeschreib|stellen sie .*dar|\bdarstell|\binterpretier|\bbegründ/, "text", "Erläutern / Beschreiben: Zusammenhänge im Fließtext verständlich darstellen."],
];

function detectOperator(question) {
  const q = (question || "").toLowerCase();
  const hit = OPERATORS.find(([re]) => re.test(q));
  return hit ? { form: hit[1], hint: hit[2] } : null;
}

const newTask = () => ({ question: "", form: "auto", subs: [] });

function renderSidePanel() {
  const panel = $("#sidePanel");
  if (!panel) return;
  panel.hidden = !ui.panel;
  $$("[data-a=design]").forEach((b) => b.classList.toggle("on", ui.panel === "design"));
  if (!ui.panel) return;
  const close = () => {
    if (ui.panel === "task") {
      currentDoc().mode = "notes";
      renderModeSeg();
    }
    ui.panel = null;
    persist();
    renderSidePanel();
  };
  if (ui.panel === "design") renderDesignPanel(panel);
  else renderTaskPanel(panel);
  $("[data-close]", panel).onclick = close;
}

function renderTaskPanel(panel) {
  const doc = currentDoc();
  const draft = (doc.taskDraft ||= { topic: "", tasks: [newTask()] });
  const formChips = (selected, auto, attr) =>
    Object.entries(ANSWER_FORMS)
      .map(([k, f]) => `<button class="chip ${k === selected ? "on" : ""}" ${attr}="${k}">${f.ico} ${f.label}${auto === k ? " ✓" : ""}</button>`)
      .join("");
  const stepper = (value, attr, min, max) =>
    `<span class="stepper"><button ${attr}="-1" ${value <= min ? "disabled" : ""}>−</button><b>${value}</b><button ${attr}="1" ${value >= max ? "disabled" : ""}>＋</button></span>`;

  panel.innerHTML = `
    <div class="panel-head">✏️ Aufgaben-Modus <button class="icon-btn" data-close>✕</button></div>
    <div class="panel-body">
      <label class="field"><span>Thema / Übungsblatt (optional)</span><input class="input" id="tkTopic" value="${esc(draft.topic)}" placeholder="z. B. Übungsblatt 3"></label>
      <div class="field-row"><span>Wie viele Aufgaben?</span>${stepper(draft.tasks.length, "data-count", 1, 10)}</div>
      ${draft.tasks
        .map((t, i) => {
          const op = detectOperator(t.question);
          const form = t.form === "auto" ? op?.form || "text" : t.form;
          return `<div class="task-card" data-task="${i}">
            <div class="task-title">Aufgabe ${i + 1}</div>
            <textarea class="input" data-q="${i}" rows="2" placeholder="Aufgabe / Frage eintippen …">${esc(t.question)}</textarea>
            ${op ? `<div class="op-hint">Erkannt: ${esc(op.hint)}</div>` : ""}
            <div class="field-row"><span>Unteraufgaben</span>${stepper(t.subs.length, `data-subs="${i}" data-step`, 0, 8)}</div>
            ${
              t.subs.length
                ? t.subs
                    .map((s, j) => {
                      const sop = detectOperator(s.question);
                      const sform = s.form === "auto" ? sop?.form || form : s.form;
                      return `<div class="sub-row">
                        <b>${String.fromCharCode(97 + j)})</b>
                        <input class="input" data-sq="${i}:${j}" value="${esc(s.question)}" placeholder="Teilaufgabe (optional)">
                        <select class="input" data-sf="${i}:${j}">${Object.entries(ANSWER_FORMS)
                          .map(([k, f]) => `<option value="${k}" ${k === sform ? "selected" : ""}>${f.ico} ${f.label}</option>`)
                          .join("")}</select></div>`;
                    })
                    .join("")
                : `<div class="field-row"><span>Wie beantworten?</span></div><div class="chip-wrap">${formChips(form, op?.form, `data-form="${i}" data-k`)}</div>`
            }
          </div>`;
        })
        .join("")}
      <button class="btn primary" id="tkInsert" style="width:100%;margin-top:6px">📄 Vorlage ins Blatt einfügen</button>
      <button class="btn" id="tkReset" style="width:100%;margin-top:8px">Neu anfangen</button>
      <p class="hint" style="margin-top:12px">Tipp: Der Fragetyp wird an Wörtern wie „erläutern“, „erörtern“ oder „vergleichen“ erkannt (✓). Du kannst ihn jederzeit ändern.</p>
    </div>`;

  const save = () => persist();
  const rerender = () => {
    const scroll = $(".panel-body", panel).scrollTop;
    renderTaskPanel(panel);
    $("[data-close]", panel).onclick = () => {
      doc.mode = "notes";
      renderModeSeg();
      ui.panel = null;
      persist();
      renderSidePanel();
    };
    $(".panel-body", panel).scrollTop = scroll;
  };
  $("#tkTopic", panel).oninput = (e) => ((draft.topic = e.target.value), save());
  $$("[data-count]", panel).forEach(
    (b) =>
      (b.onclick = () => {
        const n = draft.tasks.length + Number(b.dataset.count);
        while (draft.tasks.length < n) draft.tasks.push(newTask());
        draft.tasks.length = n;
        save();
        rerender();
      })
  );
  $$("[data-subs]", panel).forEach(
    (b) =>
      (b.onclick = () => {
        const t = draft.tasks[Number(b.dataset.subs)];
        if (Number(b.dataset.step) > 0) t.subs.push({ question: "", form: "auto" });
        else t.subs.pop();
        save();
        rerender();
      })
  );
  $$("[data-q]", panel).forEach((ta) => {
    ta.oninput = () => {
      draft.tasks[Number(ta.dataset.q)].question = ta.value;
      save();
    };
    ta.onchange = rerender; // Operator neu erkennen, wenn das Feld verlassen wird
  });
  $$("[data-form]", panel).forEach(
    (b) =>
      (b.onclick = () => {
        draft.tasks[Number(b.dataset.form)].form = b.dataset.k;
        save();
        rerender();
      })
  );
  $$("[data-sq]", panel).forEach((inp) => {
    const [i, j] = inp.dataset.sq.split(":").map(Number);
    inp.oninput = () => ((draft.tasks[i].subs[j].question = inp.value), save());
    inp.onchange = rerender;
  });
  $$("[data-sf]", panel).forEach((sel) => {
    const [i, j] = sel.dataset.sf.split(":").map(Number);
    sel.onchange = () => ((draft.tasks[i].subs[j].form = sel.value), save());
  });
  $("#tkInsert", panel).onclick = () => insertTaskTemplate(draft);
  $("#tkReset", panel).onclick = () => {
    doc.taskDraft = { topic: "", tasks: [newTask()] };
    save();
    rerender();
  };
}

function insertTaskTemplate(draft) {
  setTool("text");
  const parts = [];
  if (draft.topic.trim()) parts.push(`<h1>${esc(draft.topic.trim())}</h1>`);
  draft.tasks.forEach((t, i) => {
    const op = detectOperator(t.question);
    const form = t.form === "auto" ? op?.form || "text" : t.form;
    parts.push(`<h2>Aufgabe ${i + 1}</h2>`);
    if (t.question.trim()) parts.push(`<p><i>${esc(t.question.trim()).replace(/\n/g, "<br>")}</i></p>`);
    if (!t.subs.length) parts.push(ANSWER_FORMS[form].html);
    t.subs.forEach((s, j) => {
      const sform = s.form === "auto" ? detectOperator(s.question)?.form || form : s.form;
      parts.push(`<h3>${String.fromCharCode(97 + j)}) ${esc(s.question.trim())}</h3>`);
      parts.push(ANSWER_FORMS[sform].html);
    });
  });
  const inserted = appendBlocks(parts.join(""));
  // Cursor in das erste Feld zum Ausfüllen setzen
  const target = inserted
    .flatMap((el) => (/^(UL|OL)$/.test(el.tagName) ? [...el.children] : [el]))
    .find((el) => !/^H[1-3]$/.test(el.tagName) && !el.querySelector("i") && el.textContent.replace(/[^:]*:/, "").trim() === "");
  if (target) {
    (target.closest(".box") || editorEl).focus();
    const r = document.createRange();
    r.selectNodeContents(target);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  toast("Vorlage eingefügt – einfach ausfüllen ✍️");
}

// Fertige Designs zum Antippen
const THEMES = {
  classic: { label: "Klassisch", pageColor: "#ffffff", accentColor: "", headingColor: "" },
  blue: { label: "Blau", pageColor: "#f6f9ff", accentColor: "#0a5bd3", headingColor: "#0a3d7a" },
  green: { label: "Grün", pageColor: "#f5faf5", accentColor: "#1f8a3b", headingColor: "#145c28" },
  warm: { label: "Warm", pageColor: "#fbf7ee", accentColor: "#c25e00", headingColor: "#6b3a10" },
  rose: { label: "Rosé", pageColor: "#fdf6f8", accentColor: "#c2185b", headingColor: "#7a1240" },
  lila: { label: "Lila", pageColor: "#f9f6fe", accentColor: "#7d3cc8", headingColor: "#4a1f80" },
  minimal: { label: "Minimal", pageColor: "#ffffff", accentColor: "#8e8e93", headingColor: "#3a3a3c" },
  paper: { label: "Papier", pageColor: "#f7f3e8", accentColor: "#5c4a32", headingColor: "#3d2f1c" },
};

function renderDesignPanel(panel) {
  const doc = currentDoc();
  const d = doc.design || {};
  const accent = d.accentColor || moduleColor(doc.moduleId);
  panel.innerHTML = `
    <div class="panel-head">🎨 Design <button class="icon-btn" data-close>✕</button></div>
    <div class="panel-body">
      <div class="theme-grid">${Object.entries(THEMES)
        .map(([k, t]) => {
          const on = (d.theme || "classic") === k;
          return `<button class="theme-card ${on ? "on" : ""}" data-theme="${k}">
            <span class="theme-prev" style="background:${t.pageColor}"><i style="background:${t.accentColor || moduleColor(doc.moduleId)}"></i><em style="background:${t.headingColor}"></em><u></u><u></u></span>
            ${t.label}</button>`;
        })
        .join("")}</div>
      <div class="field"><span>Blatt</span><div class="hint">${PAPERS[doc.paper] || "Importierte Datei"} – beim Erstellen festgelegt · schreibt sich wie Word, Textfelder über ＋ Einfügen</div></div>
      ${
        doc.paper !== "blank"
          ? ""
          : `<div class="field"><span>Seitenränder</span>
        <label class="range-row">Links <input type="range" min="1" max="5" step="0.25" data-m="l" value="${doc.margins.l}"><b>${doc.margins.l} cm</b></label>
        <label class="range-row">Rechts <input type="range" min="1" max="5" step="0.25" data-m="r" value="${doc.margins.r}"><b>${doc.margins.r} cm</b></label></div>
      <div class="field"><span>Zeilenabstand</span><div class="seg" id="dsSpacing">${[1, 1.15, 1.5, 2]
        .map((v) => `<button data-sp="${v}" class="${v === doc.spacing ? "on" : ""}">${String(v).replace(".", ",")}</button>`)
        .join("")}</div></div>`
      }
      <div class="field"><span>Eigene Farben</span>
        <div class="color-row">
          <label><input type="color" data-c="pageColor" value="${esc(d.pageColor || "#ffffff")}"> Blatt</label>
          <label><input type="color" data-c="accentColor" value="${esc(accent)}"> Akzent</label>
          <label><input type="color" data-c="headingColor" value="${esc(d.headingColor || "#1c1c1e")}"> Überschriften</label>
        </div></div>
      <button class="btn" id="dsAll" style="width:100%">Für alle Blätter in „${esc(moduleName(doc.moduleId))}“ übernehmen</button>
    </div>`;
  const apply = () => {
    applyDocLook();
    touchDoc();
  };
  $$("[data-theme]", panel).forEach(
    (b) =>
      (b.onclick = () => {
        const { label, ...colors } = THEMES[b.dataset.theme];
        doc.design = { ...colors, theme: b.dataset.theme };
        apply();
        renderDesignPanel(panel);
        $("[data-close]", panel).onclick = () => ((ui.panel = null), renderSidePanel());
      })
  );
  $$("[data-m]", panel).forEach((inp) => {
    inp.oninput = () => {
      doc.margins[inp.dataset.m] = Number(inp.value);
      inp.nextElementSibling.textContent = `${String(inp.value).replace(".", ",")} cm`;
      apply();
    };
  });
  $$("#dsSpacing button", panel).forEach(
    (b) =>
      (b.onclick = () => {
        doc.spacing = Number(b.dataset.sp);
        $$("#dsSpacing button", panel).forEach((x) => x.classList.toggle("on", x === b));
        apply();
      })
  );
  $$("[data-c]", panel).forEach(
    (inp) =>
      (inp.oninput = () => {
        doc.design = { ...doc.design, [inp.dataset.c]: inp.value, theme: "custom" };
        $$(".theme-card", panel).forEach((c) => c.classList.remove("on"));
        apply();
      })
  );
  $("#dsAll", panel).onclick = () => {
    const same = semDocs().filter((x) => x.moduleId === doc.moduleId && x.id !== doc.id);
    same.forEach((x) => Object.assign(x, { design: { ...doc.design } }));
    persist();
    toast(`Design für ${same.length + 1} Blätter übernommen`);
  };
}

const stripBids = (html) => html.replace(/\sdata-bid="[^"]*"/g, "");

// ============================================================
// Stundenplan & Module
// ============================================================

function renderTimetable(main) {
  const sem = currentSemester();
  sem.timetable ||= { images: [] };
  const tt = sem.timetable;
  main.innerHTML = `
    <div class="files-head"><div class="crumbs"><button>Stundenplan &amp; Module</button></div><span class="kind-pill">${esc(sem.name)}</span></div>
    <div class="tt-wrap">
      <div class="card cal-card">
        <div class="cal-top"><div><h2>🗓 Mein Stundenplan</h2><p class="hint">Auf eine freie Stelle tippen = Veranstaltung eintragen · auf ein Modul tippen = Ordner mit deinen Blättern öffnen.</p></div>
          <button class="btn primary" id="addEntry">＋ Eintragen</button></div>
        <div id="calendar"></div>
      </div>
      <div class="tt-grid">
      <div class="card">
        <h2>📷 Stundenplan-Screenshot</h2>
        <p class="hint">Screenshots hier ablegen, einfügen (${MOD}+V) oder auswählen. Die Texterkennung läuft direkt auf deinem Gerät – kostenlos.</p>
        <div class="dropzone" id="dropzone">Bilder hierher ziehen oder <button class="btn" id="pickImg">Auswählen</button>
          <input type="file" id="imgInput" accept="image/*" multiple hidden></div>
        <div class="thumbs" id="thumbs"></div>
        <div style="margin:12px 0 4px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn primary" id="scanBtn">🔍 Module erkennen</button>
          <span class="hint" id="scanState"></span>
        </div>
        <div id="scanResult"></div>
      </div>
      <div class="card">
        <h2>🎓 Meine Module</h2>
        <p class="hint">Alle Module dieses Semesters. Farbe antippen zum Ändern, Prüfungsform auswählen oder eintippen.</p>
        <table class="module-table"><thead><tr><th>Farbe</th><th>Modul</th><th>Prüfungsform</th><th></th></tr></thead><tbody id="modBody"></tbody></table>
        <div style="margin-top:12px;display:flex;gap:8px"><input class="input" id="newModName" placeholder="Neues Modul …"><button class="btn" id="newModBtn">＋</button></div>
        <datalist id="examTypes">${EXAM_TYPES.map((t) => `<option value="${t}">`).join("")}</datalist>
      </div>
    </div></div>`;
  renderCalendar();
  $("#addEntry").onclick = () => entryDialog({});

  const renderThumbs = () => {
    $("#thumbs").innerHTML = tt.images.map((src, i) => `<div class="thumb"><img src="${src}" alt="Screenshot ${i + 1}"><button data-del="${i}" title="Entfernen">✕</button></div>`).join("");
    $$("[data-del]").forEach(
      (b) =>
        (b.onclick = () => {
          tt.images.splice(Number(b.dataset.del), 1);
          persist();
          renderThumbs();
        })
    );
  };
  const addImages = async (files) => {
    for (const f of files) if (f.type.startsWith("image/")) tt.images.push(await downscaleImage(f, 2200));
    persist();
    renderThumbs();
  };
  renderThumbs();
  renderModuleTable();

  const dz = $("#dropzone");
  dz.ondragover = (e) => (e.preventDefault(), dz.classList.add("over"));
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove("over");
    addImages([...e.dataTransfer.files]);
  };
  $("#pickImg").onclick = () => $("#imgInput").click();
  $("#imgInput").onchange = (e) => addImages([...e.target.files]);
  main.onpaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  };

  $("#scanBtn").onclick = async () => {
    if (!tt.images.length) return toast("Füge zuerst einen Screenshot deines Stundenplans hinzu.");
    const state = $("#scanState");
    const btn = $("#scanBtn");
    btn.disabled = true;
    try {
      state.textContent = "Lade Texterkennung …";
      const Tesseract = await loadTesseract();
      let text = "";
      for (let i = 0; i < tt.images.length; i++) {
        const { data } = await Tesseract.recognize(tt.images[i], "deu", {
          logger: (m) => {
            if (m.status === "recognizing text") state.textContent = `Bild ${i + 1}/${tt.images.length}: ${Math.round(m.progress * 100)} %`;
          },
        });
        text += "\n" + data.text;
      }
      state.textContent = "";
      showCandidates(moduleCandidates(text));
    } catch (err) {
      console.error(err);
      state.textContent = "";
      toast("Texterkennung fehlgeschlagen (Internet für den ersten Start nötig).", "error", 5000);
    } finally {
      btn.disabled = false;
    }
  };
  const addFromInput = () => {
    const name = $("#newModName").value.trim();
    if (!name) return;
    addModule(name);
    $("#newModName").value = "";
    renderSidebar();
    renderModuleTable();
  };
  $("#newModBtn").onclick = addFromInput;
  $("#newModName").onkeydown = (e) => e.key === "Enter" && addFromInput();
}

let tesseractPromise = null;
function loadTesseract() {
  tesseractPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      tesseractPromise = null;
      reject(new Error("Texterkennung konnte nicht geladen werden"));
    };
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

// Aus erkanntem Text die Zeilen herausfiltern, die nach Modulnamen aussehen
function moduleCandidates(text) {
  const out = new Map();
  for (const raw of text.split(/\n/)) {
    const line = raw
      .replace(/\b\d{1,2}[:.]\d{2}\s*(?:[-–]\s*\d{1,2}[:.]\d{2})?\s*(?:uhr)?/gi, " ")
      .replace(/\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Mo|Di|Mi|Do|Fr|Sa|So)\b\.?/g, " ")
      .replace(/\b(Raum|R\.|HS|Hörsaal|Geb\.?|Gebäude|Seminarraum)\s*[\w./-]*\d[\w./-]*/gi, " ")
      .replace(/\b(wöchentlich|14-täglich|zweiwöchentlich|ab|bis)\b/gi, " ")
      .replace(/[|_[\]{}<>©®@#*=~^"'`]/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, "");
    const letters = (line.match(/\p{L}/gu) || []).length;
    if (letters < 4 || letters / line.length < 0.6) continue;
    if (/^(uhrzeit|zeit|woche|kw|semester|stundenplan|winter|sommer|wise|sose|vorlesungsverzeichnis)/i.test(line)) continue;
    const key = line.toLowerCase();
    if (!out.has(key)) out.set(key, line);
  }
  return [...out.values()].slice(0, 40);
}

function showCandidates(lines) {
  const box = $("#scanResult");
  if (!box) return;
  if (!lines.length) {
    box.innerHTML = `<p class="hint">Keine Modulnamen erkannt. Tipp: Screenshot größer/schärfer machen oder Module rechts von Hand eintragen.</p>`;
    return;
  }
  box.innerHTML = `
    <p class="hint" style="margin-top:12px">Erkannte Zeilen – hake deine Module an und korrigiere die Namen bei Bedarf:</p>
    <div class="cand-list">${lines
      .map((l, i) => {
        const exists = !!findModule(l);
        return `<label class="check-row"><input type="checkbox" data-c="${i}" ${exists ? "disabled" : ""}>
          <input class="input" data-n="${i}" value="${esc(l)}">${exists ? '<small style="white-space:nowrap">schon da</small>' : ""}</label>`;
      })
      .join("")}</div>
    <button class="btn primary" id="addCands" style="margin-top:10px">＋ Ausgewählte hinzufügen</button>`;
  $("#addCands").onclick = () => {
    let n = 0;
    for (const c of $$("[data-c]", box)) {
      const name = $(`[data-n="${c.dataset.c}"]`, box).value.trim();
      if (c.checked && name && !semModules().some((m) => m.name.toLowerCase() === name.toLowerCase())) {
        addModule(name);
        n++;
      }
    }
    if (!n) return toast("Nichts ausgewählt.");
    toast(`${n} Modul(e) hinzugefügt ✓ – jetzt oben im Kalender eintragen`, "", 4000);
    box.innerHTML = "";
    renderSidebar();
    renderModuleTable();
  };
}

// ---------- Kalender ----------

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const EVENT_TYPES = ["Vorlesung", "Seminar", "Übung", "Tutorium", "Kolloquium", "Praktikum", "Sonstiges"];
const toMin = (t) => {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return h * 60 + (m || 0);
};

function renderCalendar() {
  const box = $("#calendar");
  if (!box) return;
  const tt = currentSemester().timetable;
  const entries = (tt.entries ||= []).filter((e) => moduleById(e.moduleId));
  const days = entries.some((e) => e.day === 5) ? 6 : 5;
  let startH = 8;
  let endH = 18;
  for (const e of entries) {
    startH = Math.min(startH, Math.floor(toMin(e.start) / 60));
    endH = Math.max(endH, Math.ceil(toMin(e.end) / 60));
  }
  const PX = 0.85; // Pixel pro Minute
  const top = (min) => (min - startH * 60) * PX;
  const today = (new Date().getDay() + 6) % 7;
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i);

  const column = (day) => {
    const list = entries.filter((e) => e.day === day).sort((a, b) => toMin(a.start) - toMin(b.start));
    // Überschneidungen nebeneinander anzeigen
    const lanes = [];
    for (const e of list) {
      let lane = lanes.findIndex((end) => end <= toMin(e.start));
      if (lane < 0) lane = lanes.push(0) - 1;
      lanes[lane] = toMin(e.end);
      e._lane = lane;
    }
    const n = Math.max(1, lanes.length);
    return list
      .map((e) => {
        const m = moduleById(e.moduleId);
        return `<div class="cal-entry" data-entry="${e.id}" role="button" tabindex="0"
          style="top:${top(toMin(e.start))}px;height:${Math.max(26, (toMin(e.end) - toMin(e.start)) * PX - 2)}px;left:calc(${(e._lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px);--c:${esc(m.color)}">
          <b>${esc(m.name)}</b>${e.type ? `<small class="cal-type">${esc(e.type)}</small>` : ""}<small>${esc(e.start)}–${esc(e.end)}${e.room ? ` · ${esc(e.room)}` : ""}</small>
          <button class="cal-edit" data-edit="${e.id}" title="Bearbeiten">✎</button></div>`;
      })
      .join("");
  };

  box.innerHTML = `
    <div class="cal" style="--days:${days}">
      <div class="cal-head"><span></span>${DAYS.slice(0, days)
        .map((d, i) => `<span class="${i === today ? "today" : ""}">${d.slice(0, 2)}<em>${d}</em></span>`)
        .join("")}</div>
      <div class="cal-body" style="height:${(endH - startH) * 60 * PX}px;--hour:${60 * PX}px">
        <div class="cal-times">${hours.map((h) => `<span style="top:${top(h * 60)}px">${h}:00</span>`).join("")}</div>
        ${Array.from({ length: days }, (_, d) => `<div class="cal-day ${d === today ? "today" : ""}" data-day="${d}">${column(d)}</div>`).join("")}
      </div>
    </div>
    ${entries.length ? "" : `<p class="hint" style="margin-top:10px">Noch leer. Lege zuerst deine Module an (unten), dann trage sie hier ein.</p>`}`;

  $$(".cal-day", box).forEach(
    (col) =>
      (col.onclick = (e) => {
        if (e.target.closest(".cal-entry")) return;
        const y = e.clientY - col.getBoundingClientRect().top;
        const h = Math.min(endH - 1, Math.max(startH, startH + Math.floor(y / (60 * PX))));
        const pad = (n) => String(n).padStart(2, "0");
        entryDialog({ day: Number(col.dataset.day), start: `${pad(h)}:00`, end: `${pad(h + 1)}:30` });
      })
  );
  $$(".cal-entry", box).forEach((el) => {
    const entry = entries.find((x) => x.id === el.dataset.entry);
    const open = (e) => {
      if (e.target.closest(".cal-edit")) return entryDialog(entry);
      ui.view = "files";
      ui.loc = { moduleId: entry.moduleId, folderId: null };
      ui.search = "";
      renderAll();
    };
    el.onclick = open;
    el.onkeydown = (e) => e.key === "Enter" && open(e);
  });
}

async function entryDialog(entry) {
  const mods = semModules();
  const isNew = !entry.id;
  const p = openModal(`
    <h3>${isNew ? "Veranstaltung eintragen" : "Veranstaltung bearbeiten"}</h3>
    <label class="field"><span>Modul</span><select class="input" id="enMod">
      ${mods.map((m) => `<option value="${m.id}" ${m.id === entry.moduleId ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
      <option value="__new">＋ Neues Modul …</option></select></label>
    <label class="field" id="enNewWrap" ${mods.length ? "hidden" : ""}><span>Name des neuen Moduls</span><input class="input" id="enNew"></label>
    <div class="field"><span>Art der Veranstaltung</span><div class="chip-wrap" id="enType">${EVENT_TYPES.map(
      (t) => `<button class="chip ${t === (entry.type || "Vorlesung") ? "on" : ""}" data-type="${t}">${t}</button>`
    ).join("")}</div></div>
    <label class="field"><span>Tag</span><select class="input" id="enDay">${DAYS.map((d, i) => `<option value="${i}" ${i === (entry.day ?? 0) ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    <div style="display:flex;gap:10px">
      <label class="field" style="flex:1"><span>Von</span><input class="input" type="time" id="enStart" value="${esc(entry.start || "10:00")}"></label>
      <label class="field" style="flex:1"><span>Bis</span><input class="input" type="time" id="enEnd" value="${esc(entry.end || "11:30")}"></label>
    </div>
    <label class="field"><span>Raum (optional)</span><input class="input" id="enRoom" value="${esc(entry.room || "")}" placeholder="z. B. HS 3"></label>
    <div class="modal-actions">${isNew ? "" : `<button class="btn danger left" data-del>Löschen</button>`}<button class="btn" data-x>Abbrechen</button><button class="btn primary" data-ok>Speichern</button></div>`);
  const m = openModal.lastModal;
  const modSel = $("#enMod", m);
  if (!mods.length) modSel.value = "__new";
  modSel.onchange = () => ($("#enNewWrap", m).hidden = modSel.value !== "__new");
  let type = entry.type || "Vorlesung";
  $$("#enType [data-type]", m).forEach(
    (b) =>
      (b.onclick = () => {
        type = b.dataset.type;
        $$("#enType [data-type]", m).forEach((x) => x.classList.toggle("on", x === b));
      })
  );
  $("[data-x]", m).onclick = () => m.close(null);
  $("[data-del]", m)?.addEventListener("click", () => m.close("delete"));
  $("[data-ok]", m).onclick = () => {
    let moduleId = modSel.value;
    if (moduleId === "__new") {
      const name = $("#enNew", m).value.trim();
      if (!name) return $("#enNew", m).focus();
      moduleId = (findModule(name) && findModule(name).name.toLowerCase() === name.toLowerCase() ? findModule(name) : addModule(name)).id;
    }
    const start = $("#enStart", m).value;
    const end = $("#enEnd", m).value;
    if (!start || !end || toMin(end) <= toMin(start)) return toast("Bitte gültige Uhrzeiten eingeben.");
    m.close({ moduleId, type, day: Number($("#enDay", m).value), start, end, room: $("#enRoom", m).value.trim() });
  };
  const res = await p;
  if (!res) return;
  const tt = currentSemester().timetable;
  tt.entries ||= [];
  if (res === "delete") tt.entries = tt.entries.filter((x) => x.id !== entry.id);
  else if (isNew) tt.entries.push({ id: uid(), ...res });
  else Object.assign(entry, res);
  persist();
  renderSidebar();
  renderCalendar();
  renderModuleTable();
}

function findModule(name) {
  const n = name.trim().toLowerCase();
  const mods = semModules();
  return mods.find((m) => m.name.toLowerCase() === n) || mods.find((m) => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase()));
}

function renderModuleTable() {
  const body = $("#modBody");
  if (!body) return;
  const mods = semModules();
  body.innerHTML = mods.length
    ? mods
        .map(
          (m) => `<tr data-id="${m.id}">
        <td><input type="color" value="${esc(m.color)}" data-f="color"></td>
        <td><input class="input" value="${esc(m.name)}" data-f="name"></td>
        <td><input class="input" value="${esc(m.examType)}" data-f="examType" list="examTypes" placeholder="z. B. Klausur"></td>
        <td style="white-space:nowrap"><button class="btn" data-new title="Neues Blatt">📝</button> <button class="btn danger" data-del title="Löschen">🗑</button></td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="side-empty">Noch keine Module – lade deinen Stundenplan hoch.</td></tr>`;
  $$("tr[data-id]", body).forEach((tr) => {
    const mod = moduleById(tr.dataset.id);
    $$("[data-f]", tr).forEach((inp) => {
      inp.oninput = () => {
        mod[inp.dataset.f] = inp.value;
        persist();
      };
      inp.onchange = () => renderSidebar();
    });
    $("[data-new]", tr).onclick = () => newSheetDialog({ moduleId: mod.id });
    $("[data-del]", tr).onclick = () => moduleMenu(mod.id);
  });
}

function downscaleImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ============================================================
// Export
// ============================================================

async function exportDialog(docs, name) {
  if (!docs.length) return toast("Keine Blätter zum Exportieren.");
  const formats = [
    ["pdf", "📕 PDF", "Zum Drucken oder Abgeben"],
    ["doc", "📘 Word (.doc)", "Öffnet in Word & Pages"],
    ["md", "📗 Markdown (.md)", "Für Notion, Obsidian & Co."],
    ["txt", "📄 Text (.txt)", "Nur Text"],
    ["html", "🌐 Webseite (.html)", "Mit Design & Zeichnungen"],
  ];
  const p = openModal(`
    <h3>Exportieren</h3><p class="lead">${esc(name)}${docs.length > 1 ? ` · ${docs.length} Blätter` : ""}</p>
    <div class="menu">${formats.map(([k, l, d]) => `<button data-f="${k}">${l} <span style="color:var(--muted)">${d}</span></button>`).join("")}</div>`);
  const m = openModal.lastModal;
  $$("[data-f]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.f)));
  const fmt = await p;
  if (fmt) exportDocs(docs, fmt, name);
}

// Zusatz-Stile nur für den Export: echte A4-Seiten zum Drucken / als PDF
const EXPORT_CSS = `
  html, body { margin: 0; background: #e5e5ea; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow: visible !important; height: auto !important; }
  .ex-page { position: relative; width: 794px; height: 1123px; margin: 24px auto; padding: 0; overflow: hidden; break-after: page; page-break-after: always; }
  .ex-page:last-child { break-after: auto; page-break-after: auto; }
  .ex-page .bg-page { top: 0; height: 1123px; }
  .ex-page .page-content { min-height: 0; }
  .ex-page .drawing { position: absolute; left: 0; top: 0; width: 794px; height: 1120px; z-index: 2; }
  .ex-page.glossary-only { height: auto; min-height: 1123px; background: var(--page-bg); box-shadow: var(--shadow); padding: 56px 64px; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  @media print { html, body { background: none; } .ex-page { margin: 0; } .ex-page .bg-page { box-shadow: none; border-radius: 0; } }`;

function docTerms(doc) {
  migrateDoc(doc);
  const box = document.createElement("div");
  box.innerHTML = doc.html + (doc.floats || "");
  const map = new Map();
  for (const t of box.querySelectorAll("span.term")) {
    const term = t.textContent.trim().replace(/[.,;:!?]+$/, "");
    if (term && !map.has(term.toLowerCase())) map.set(term.toLowerCase(), term);
  }
  return [...map.values()]
    .sort((a, b) => a.localeCompare(b, "de"))
    .map((t) => ({ term: t, explanation: doc.glossary?.[t.toLowerCase()]?.explanation || "" }));
}

const docHeading = (doc) => doc.heading ?? (doc.moduleId ? moduleName(doc.moduleId) : doc.title);

function docVars(doc) {
  const d = doc.design || {};
  const accent = d.accentColor || moduleColor(doc.moduleId);
  const ins = insets(doc);
  return `--page-bg:${d.pageColor || "#fff"};--heading:${d.headingColor || accent};--doc-accent:${accent};--doc-font:${
    FONTS[doc.font] || FONTS[state.settings.font]
  };--doc-size:${state.settings.fontSize}pt;--pad-l:${ins.l}px;--pad-r:${ins.r}px;--spacing:${doc.spacing || 1.5}`;
}

// Inhalt ohne freie Blöcke (für Word, Markdown, Text): Blöcke von oben nach unten
function flatHtml(doc) {
  migrateDoc(doc);
  const box = document.createElement("div");
  box.innerHTML = sanitizeHtml(doc.floats || "");
  const floats = $$(":scope > .box:not(.locked)", box)
    .sort((a, b) => a.dataset.y - b.dataset.y || a.dataset.x - b.dataset.x)
    .map((b) => (b.classList.contains("img-box") ? b.innerHTML.replace("<img ", '<img style="width:60%" ') : b.innerHTML));
  return stripBids(sanitizeHtml(doc.html) + floats.join(""));
}

// Baut das Blatt unsichtbar auf, rechnet die Seiten aus und teilt alles auf echte A4-Seiten auf
function docToPagesHtml(doc) {
  migrateDoc(doc);
  const cls = `paper-${doc.paper} ${isRuled(doc) ? "ruled" : "flow"}`;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none";
  host.innerHTML = `<div class="sheet ${cls}" style="${docVars(doc)}">
    <div class="sheet-bg"></div><div class="doc-title">${esc(docHeading(doc))}</div><div class="page-content">${isPdf(doc) ? "" : sanitizeHtml(doc.html)}</div>
    <div class="float-layer">${sanitizeHtml(doc.floats || "")}</div></div>`;
  document.body.appendChild(host);
  const sheet = host.firstElementChild;
  const editor = $(".page-content", sheet);
  const floats = $(".float-layer", sheet);
  $$(":scope > .box", floats).forEach(placeBox);
  const pages = layoutPages(sheet, editor, { ...doc, pages: doc.pages || 1 }, 1, floats);
  const pageOf = (el) => Math.max(0, Math.min(pages - 1, Math.floor((el.getBoundingClientRect().top - sheet.getBoundingClientRect().top + 1) / STRIDE)));
  const content = Array.from({ length: pages }, () => []);
  const floatContent = Array.from({ length: pages }, () => []);
  const clean = (el) => {
    const c = el.cloneNode(true);
    c.style.marginTop = "";
    $$("[style]", c).forEach((x) => (x.style.marginTop = ""));
    return c;
  };
  for (const el of [...editor.children]) {
    if (/^(UL|OL)$/.test(el.tagName)) {
      let group = null;
      let groupPage = -1;
      [...el.children].forEach((li, i) => {
        const n = pageOf(li);
        if (n !== groupPage) {
          group = el.cloneNode(false);
          group.style.marginTop = "";
          if (el.tagName === "OL" && i) group.setAttribute("start", i + 1);
          content[n].push(group);
          groupPage = n;
        }
        group.appendChild(clean(li));
      });
    } else content[pageOf(el)].push(clean(el));
  }
  for (const b of $$(":scope > .box", floats)) {
    const y = Number(b.dataset.y);
    const n = Math.max(0, Math.min(pages - 1, Math.floor(y / STRIDE)));
    const c = b.cloneNode(true);
    Object.assign(c.style, { left: b.dataset.x + "px", top: y - n * STRIDE + "px", width: b.dataset.w + "px" });
    floatContent[n].push(c.outerHTML);
  }
  host.remove();

  const ins = insets(doc);
  const terms = docTerms(doc);
  const pagesHtml = content.map((items, n) => {
    const html = items.map((x) => (typeof x === "string" ? x : x.outerHTML)).join("");
    const drawing = renderStrokesForPage(doc, n);
    return `<section class="ex-page sheet ${cls}" style="${docVars(doc)}">
      <div class="sheet-bg"><div class="bg-page"><div class="pg-lines" style="top:${n ? 0 : CONTENT_TOP}px"></div><span class="pg-num">${n + 1}</span></div></div>
      <div class="page-content" style="position:absolute;left:${ins.l}px;right:${ins.r}px;top:${n ? PAGE_TOP : CONTENT_TOP}px">${stripBids(html)}</div>
      <div class="float-layer">${stripBids(floatContent[n].join(""))}</div>
      ${n === 0 ? `<div class="sheet-date">${esc(fmtLong(doc.createdAt))}</div>${isPdf(doc) ? "" : `<div class="doc-title" style="position:absolute;top:56px;left:${ins.l}px;right:${ins.r}px">${esc(docHeading(doc))}</div>`}` : ""}
      ${drawing ? `<img class="drawing" src="${drawing}" alt="">` : ""}
    </section>`;
  });
  if (terms.length) {
    pagesHtml.push(`<section class="ex-page glossary-only sheet" style="${docVars(doc)}"><div class="glossary"><h4>Fachbegriffe</h4><dl>${terms
      .map((t) => `<dt class="term-name">${esc(t.term)}</dt><dd>${esc(t.explanation || "–")}</dd>`)
      .join("")}</dl></div></section>`);
  }
  return pagesHtml.join("");
}

let appCssCache = null;
async function appCss() {
  appCssCache ||= await fetch("styles.css").then((r) => r.text()).catch(() => "");
  return appCssCache;
}

async function exportHtmlDocument(docs, name) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(name)}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,700;1,400&display=swap">
    <style>${await appCss()}${EXPORT_CSS}</style></head>
    <body>${docs.map(docToPagesHtml).join("")}</body></html>`;
}

function htmlToMarkdown(html) {
  const box = document.createElement("div");
  box.innerHTML = html;
  const inline = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/ /g, " ");
    if (n.nodeType !== 1) return "";
    const inner = [...n.childNodes].map(inline).join("");
    if (n.tagName === "BR") return "  \n";
    if (/^(B|STRONG)$/.test(n.tagName) || n.classList.contains("term")) return inner.trim() ? `**${inner}**` : inner;
    if (/^(I|EM)$/.test(n.tagName)) return inner.trim() ? `*${inner}*` : inner;
    return inner;
  };
  const list = (el, depth) =>
    [...el.children]
      .map((li, i) => {
        const nested = [...li.children].filter((c) => /^(UL|OL)$/.test(c.tagName));
        const text = [...li.childNodes].filter((c) => !nested.includes(c)).map(inline).join("").trim();
        const marker = el.tagName === "OL" ? `${i + 1}.` : "-";
        return `${"  ".repeat(depth)}${marker} ${text}` + nested.map((nl) => "\n" + list(nl, depth + 1)).join("");
      })
      .join("\n");
  return [...box.children]
    .map((el) => {
      const t = el.tagName;
      if (t === "H1") return `## ${inline(el).trim()}`;
      if (t === "H2") return `### ${inline(el).trim()}`;
      if (t === "H3") return `#### ${inline(el).trim()}`;
      if (t === "UL" || t === "OL") return list(el, 0);
      return inline(el).trim();
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

function markdownToHtml(md) {
  const out = [];
  let list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
  for (const line of md.split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*•]|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      const type = li[1] ? "ol" : "ul";
      if (list !== type) {
        if (list) out.push(`</${list}>`);
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    if (h) out.push(`<h${Math.min(3, h[1].length)}>${inline(h[2])}</h${Math.min(3, h[1].length)}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}

function docToMarkdown(doc) {
  const terms = docTerms(doc);
  return [
    `# ${docHeading(doc) || doc.title}`,
    `_${doc.title} · ${moduleName(doc.moduleId)} · ${fmtLong(doc.createdAt)}_`,
    htmlToMarkdown(flatHtml(doc)),
    terms.length ? `---\n\n**Fachbegriffe**\n\n${terms.map((t) => `- **${t.term}**: ${t.explanation || "–"}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function docToText(doc) {
  return docToMarkdown(doc)
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^_(.+)_$/gm, "$1");
}

async function exportDocs(docs, fmt, name) {
  const file = safeFileName(name);
  if (fmt === "pdf") {
    const w = window.open("", "_blank");
    if (!w) return toast("Pop-up wurde blockiert – bitte erlauben.", "error");
    w.document.write(await exportHtmlDocument(docs, name));
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 500);
    return;
  }
  if (fmt === "html") return download(`${file}.html`, await exportHtmlDocument(docs, name), "text/html");
  if (fmt === "doc") {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(name)}</title>
      <style>body{font-family:${FONTS[docs[0]?.font] || FONTS[state.settings.font]};font-size:${state.settings.fontSize}pt} h1{font-size:20pt} h2{font-size:15pt} h3{font-size:12.5pt} .term,.term-name{color:#e0201b;font-weight:bold} table{border-collapse:collapse} td,th{border:1px solid #999;padding:2px 6px} img{max-width:100%}</style></head><body>
      ${docs
        .map((d, i) => {
          const terms = docTerms(d);
          const drawings = Array.from({ length: d.pages || 1 }, (_, n) => renderStrokesForPage(d, n)).filter(Boolean);
          return `${i ? '<br style="page-break-before:always">' : ""}<p style="text-align:right;color:#666">${esc(moduleName(d.moduleId))} · ${esc(fmtLong(d.createdAt))}</p>
            <h1 style="color:${esc(moduleColor(d.moduleId))}">${esc(docHeading(d) || d.title)}</h1>${flatHtml(d)}
            ${drawings.map((u) => `<p><img src="${u}" width="600"></p>`).join("")}
            ${terms.length ? `<hr><h3>Fachbegriffe</h3>${terms.map((t) => `<p><span class="term-name">${esc(t.term)}</span>: ${esc(t.explanation || "–")}</p>`).join("")}` : ""}`;
        })
        .join("")}</body></html>`;
    return download(`${file}.doc`, "﻿" + html, "application/msword");
  }
  if (fmt === "md") return download(`${file}.md`, docs.map(docToMarkdown).join("\n\n---\n\n"), "text/markdown");
  if (fmt === "txt") return download(`${file}.txt`, docs.map(docToText).join("\n\n――――――――――\n\n"), "text/plain");
}

// ============================================================
// Einstellungen
// ============================================================

async function settingsDialog() {
  const s = state.settings;
  const sem = currentSemester();
  const p = openModal(
    `
    <h3>Einstellungen</h3>
    <p class="lead">Überschriften sind in allen Blättern einheitlich. Die Schriftart kannst du pro Blatt in der Schriftleiste ändern.</p>
    <label class="field"><span>Standard-Schriftart für neue Blätter</span><select class="input" id="setFont">${Object.keys(FONTS)
      .map((f) => `<option ${f === s.font ? "selected" : ""} style="font-family:${FONTS[f]}">${f}</option>`)
      .join("")}</select></label>
    <label class="field"><span>Schriftgröße</span><select class="input" id="setSize">${[11, 12]
      .map((n) => `<option value="${n}" ${n === s.fontSize ? "selected" : ""}>${n} pt</option>`)
      .join("")}</select></label>
    <div class="field"><span>Darstellung</span>
      <div class="seg" id="setTheme">${[
        ["auto", "Automatisch"],
        ["light", "☀︎ Hell"],
        ["dark", "☾ Dunkel"],
      ]
        .map(([k, l]) => `<button data-theme-opt="${k}" class="${(s.theme || "auto") === k ? "on" : ""}">${l}</button>`)
        .join("")}</div>
    </div>
    <label class="check-row" style="border:0;padding:0 0 12px"><input type="checkbox" id="setPencil" ${s.pencilDraws !== false ? "checked" : ""}><span><b>Apple Pencil zeichnet immer</b><small>Auch im Schreib-Modus malt der Stift, Finger & Tastatur schreiben.</small></span></label>
    <label class="field"><span>Standard-Blatt</span><select class="input" id="setPaper">${Object.entries(PAPERS)
      .map(([k, v]) => `<option value="${k}" ${k === s.paper ? "selected" : ""}>${v}</option>`)
      .join("")}</select></label>
    <div class="field"><span>Semester „${esc(sem.name)}“</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="renSem">Umbenennen</button>${
        state.semesters.length > 1 ? `<button class="btn danger" id="delSem">Semester löschen</button>` : ""
      }</div></div>
    <div class="field"><span>Datensicherung (bis der Uni-Speicher angebunden ist)</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="backup">⤓ Backup herunterladen</button><button class="btn" id="restore">⤒ Backup laden</button></div></div>
    <div class="field"><span>Tastenkürzel</span>
      <div class="shortcut-list">
        <kbd>${MOD}+S</kbd><span>Speichern (danach Frage: verbessern?)</span>
        <kbd>${MOD}+Shift+F</kbd><span>Markierung als Fachbegriff (rot)</span>
        <kbd>${HEAD_MOD}+1/2/3</kbd><span>Überschrift 1/2/3 · <kbd>${HEAD_MOD}+0</kbd> Text</span>
        <kbd>${MOD}+Shift+L</kbd><span>Stichpunkte</span>
        <kbd>${MOD}+Alt+P</kbd><span>Schrift ↔ Stift</span>
        <kbd>${MOD}+Alt+N</kbd><span>Neues Blatt</span>
        <kbd># </kbd><span>am Zeilenanfang = Überschrift, <kbd>- </kbd> = Liste, <kbd>1. </kbd> = Nummerierung</span>
        <kbd>Tab</kbd><span>in Listen einrücken</span>
      </div></div>
    <div class="modal-actions"><button class="btn primary" data-ok>Fertig</button></div>`,
    { wide: true }
  );
  const m = openModal.lastModal;
  $("#setFont", m).onchange = (e) => ((s.font = e.target.value), applySettings());
  $("#setSize", m).onchange = (e) => ((s.fontSize = Number(e.target.value)), applySettings());
  $("#setPaper", m).onchange = (e) => ((s.paper = e.target.value), persist());
  $("#setPencil", m).onchange = (e) => ((s.pencilDraws = e.target.checked), persist());
  $$("[data-theme-opt]", m).forEach(
    (b) =>
      (b.onclick = () => {
        s.theme = b.dataset.themeOpt;
        $$("[data-theme-opt]", m).forEach((x) => x.classList.toggle("on", x === b));
        applySettings();
      })
  );
  $("#renSem", m).onclick = async () => {
    m.close();
    const name = await promptModal("Semester umbenennen", "Name", sem.name);
    if (name) sem.name = name;
    persist();
    renderAll();
  };
  $("#delSem", m)?.addEventListener("click", async () => {
    m.close();
    if (!(await confirmModal("Semester löschen?", `„${sem.name}“ mit allen Modulen und Blättern wird endgültig gelöscht.`, "Löschen", { danger: true }))) return;
    state.docs = state.docs.filter((d) => d.semesterId !== sem.id);
    state.files.filter((f) => f.semesterId === sem.id).forEach((f) => delBlob(f.id));
    state.files = state.files.filter((f) => f.semesterId !== sem.id);
    state.modules = state.modules.filter((d) => d.semesterId !== sem.id);
    state.folders = state.folders.filter((d) => d.semesterId !== sem.id);
    state.semesters = state.semesters.filter((x) => x.id !== sem.id);
    await switchSemester(state.semesters[0].id);
  });
  $("#backup", m).onclick = () => download(`Notizheft-Backup-${fmtShort(Date.now())}.json`, JSON.stringify(state), "application/json");
  $("#restore", m).onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (!data.semesters || !data.docs) throw new Error();
        if (!(await confirmModal("Backup laden?", "Alle aktuellen Daten werden durch das Backup ersetzt.", "Laden", { danger: true }))) return;
        state = data;
        await writeState();
        ui.view = "files";
        ui.loc = { moduleId: undefined, folderId: null };
        applySettings();
        renderAll();
        toast("Backup geladen ✓");
      } catch {
        toast("Keine gültige Backup-Datei.", "error");
      }
    };
    input.click();
  };
  $("[data-ok]", m).onclick = () => m.close();
  await p;
  if (ui.view === "editor") renderSubbar();
}

// Dark Mode: Automatisch (wie das iPad), Hell oder Dunkel
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = state.settings.theme || "auto";
  const dark = t === "dark" || (t === "auto" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  localStorage.setItem("nh-theme", JSON.stringify({ t }));
}
darkQuery.addEventListener?.("change", () => state && applyTheme());

function applySettings() {
  applyTheme();
  document.documentElement.style.setProperty("--doc-font", FONTS[state.settings.font] || FONTS.Arial);
  document.documentElement.style.setProperty("--doc-size", state.settings.fontSize + "pt");
  persist();
}

// ============================================================
// Globale Tastenkürzel & Start
// ============================================================

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalClose) return modalClose(null);
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || modalClose) return;
  const key = e.key.toLowerCase();
  const inEditor = ui.view === "editor" && editorEl;
  if (key === "s" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (inEditor) saveDoc({ ask: true });
    else toast("Alles gespeichert ✓");
    return;
  }
  if (e.altKey && (e.code === "KeyN" || key === "n")) {
    e.preventDefault();
    const moduleId = ui.view === "editor" ? currentDoc().moduleId : ui.loc.moduleId ?? null;
    return newSheetDialog({ moduleId });
  }
  if (!inEditor) return;
  if (e.shiftKey && key === "f") {
    e.preventDefault();
    editorEl.focus();
    toggleTerm();
  } else if (e.shiftKey && key === "l") {
    e.preventDefault();
    runCommand("insertUnorderedList");
  } else if ((isMac ? e.altKey : e.shiftKey && !e.altKey) && /^Digit[0-3]$/.test(e.code)) {
    e.preventDefault();
    editorEl.focus();
    setBlock(e.code === "Digit0" ? "p" : "h" + e.code.slice(-1));
  } else if (e.altKey && e.code === "KeyP") {
    e.preventDefault();
    setTool(ui.tool === "pen" ? "text" : "pen");
  }
});

window.addEventListener("beforeunload", () => {
  if (ui.view === "editor" && editorEl) currentDoc().html = editorEl.innerHTML;
  writeState();
});

$("#semesterSelect").addEventListener("change", (e) => (e.target.value === "__new" ? newSemester() : switchSemester(e.target.value)));
$("#settingsBtn").addEventListener("click", settingsDialog);
$("#sidebarToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

(async function init() {
  state = (await loadState()) || defaultState();
  if (!state.semesters?.length) state = defaultState();
  if (!state.semesters.some((s) => s.id === state.currentSemesterId)) state.currentSemesterId = state.semesters[0].id;
  state.files ||= [];
  applySettings();
  document.body.classList.toggle("focus", localStorage.getItem("nh-focus") === "1");
  renderAll();
})();
