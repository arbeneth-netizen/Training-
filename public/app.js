// Notizheft – Uni-Notizen im Pages-Stil, optimiert fürs Schreiben mit der Tastatur.
// Alle Daten liegen lokal im Browser (IndexedDB). Die KI-Funktionen laufen über /api/* auf dem Server.

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

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Ungültige Antwort vom Server" }));
  if (!res.ok) throw new Error(data.error || "Fehler bei der KI-Anfrage");
  return data;
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
  "Times New Roman": '"Times New Roman", "Liberation Serif", Times, serif',
  Calibri: 'Calibri, Carlito, "Segoe UI", sans-serif',
  Cambria: 'Cambria, Caladea, Georgia, serif',
  Garamond: 'Garamond, "EB Garamond", "Times New Roman", serif',
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
  ["#c25e00", "Orange"],
  ["#7d3cc8", "Lila"],
];
const PEN_COLORS = ["#1c1c1e", "#0a5bd3", "#e0201b", "#1f8a3b", "#c25e00", "#7d3cc8"];
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
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

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
  const sem = { id: uid(), name: semesterName(new Date()), timetable: { images: [], chat: [] } };
  return {
    version: 1,
    settings: { font: "Arial", fontSize: 12, paper: "lined" },
    semesters: [sem],
    currentSemesterId: sem.id,
    modules: [],
    folders: [],
    docs: [],
  };
}

let state;

const ui = {
  view: "files", // files | recent | timetable | editor
  loc: { moduleId: undefined, folderId: null }, // moduleId undefined = Wurzel, null = Sonstiges
  docId: null,
  tool: "text",
  pen: { kind: "pen", color: PEN_COLORS[0], width: 3 },
  panel: null, // chat | task
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
    mode: kind === "task" ? "task" : "notes",
    title: title || `${KINDS[kind].label} ${fmtShort(now)}`,
    html: "",
    strokes: [],
    glossary: {},
    improved: {},
    declinedSig: "",
    design: {},
    task: "",
    chat: [],
    createdAt: now,
    updatedAt: now,
  };
  state.docs.push(doc);
  persist();
  return doc;
}

// ============================================================
// HTML säubern (für KI-Antworten, Import, Einfügen)
// ============================================================

const ALLOWED_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "BR", "SPAN"]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "IMG", "SVG", "VIDEO", "AUDIO", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);

function cleanNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    if (DROP_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }
    cleanNode(child);
    if (!ALLOWED_TAGS.has(child.tagName)) {
      const tag = child.tagName;
      const isBlock = /^(H[4-6]|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE|TABLE|TR)$/.test(tag);
      if (isBlock) {
        const p = document.createElement(/^H[4-6]$/.test(tag) ? "h3" : "p");
        p.append(...child.childNodes);
        child.replaceWith(p);
      } else {
        child.replaceWith(...child.childNodes);
      }
      continue;
    }
    const color = child.style?.color;
    const fontSize = child.style?.fontSize;
    const isTerm = child.classList?.contains("term");
    const bid = child.getAttribute("data-bid");
    for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    if (isTerm) child.className = "term";
    if (color) child.style.color = color;
    if (fontSize && /^\d+(\.\d+)?(pt|px)$/.test(fontSize)) child.style.fontSize = fontSize;
    if (bid) child.setAttribute("data-bid", bid);
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
  const sem = { id: uid(), name, timetable: { images: [], chat: [] } };
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
    bd.onclick = (e) => e.target === bd && modalClose(null);
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
      <button data-a="import">📥 Datei importieren (.txt, .md, .html)</button>
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

function importFiles(moduleId, folderId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.md,.markdown,.html,.htm";
  input.multiple = true;
  input.onchange = async () => {
    let last;
    for (const file of input.files) {
      const text = await file.text();
      const title = file.name.replace(/\.[^.]+$/, "");
      let html;
      if (/\.html?$/i.test(file.name)) html = sanitizeHtml(new DOMParser().parseFromString(text, "text/html").body.innerHTML);
      else if (/\.(md|markdown)$/i.test(file.name)) html = markdownToHtml(text);
      else html = text.split(/\n/).map((l) => `<p>${esc(l) || "<br>"}</p>`).join("");
      last = createDoc({ moduleId, folderId, kind: "notes", title });
      last.html = html;
    }
    persist();
    renderAll();
    if (last) toast(`${input.files.length} Datei(en) importiert`);
  };
  input.click();
}

// ============================================================
// Dateiübersicht (wie Apple Dateien)
// ============================================================

function folderSvg(color) {
  return `<svg class="folder-ico" viewBox="0 0 74 58"><path d="M4 10a6 6 0 0 1 6-6h17l6 6h31a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="${esc(color)}" opacity=".55"/><path d="M4 18a6 6 0 0 1 6-6h54a6 6 0 0 1 6 6v30a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="${esc(color)}"/></svg>`;
}

function paperIcon(doc) {
  const color = moduleColor(doc.moduleId);
  return `<div class="paper-ico"><span class="stripe" style="background:${esc(color)}"></span><i class="h"></i><i></i><i class="t"></i><i></i><i style="width:60%"></i><span class="badge">${KINDS[doc.kind]?.ico || ""}</span></div>`;
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
      ...semModules().map((m) => ({ type: "module", id: m.id, name: m.name, color: m.color, sub: m.examType || `${semDocs().filter((d) => d.moduleId === m.id).length} Objekte` })),
      { type: "module", id: null, name: "Sonstiges", color: "#8e8e93", sub: `${semDocs().filter((d) => !d.moduleId).length} Objekte` },
    ];
    docs = [];
  } else {
    folders = state.folders
      .filter((f) => f.semesterId === state.currentSemesterId && f.moduleId === moduleId && f.parentId === folderId)
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .map((f) => ({ type: "folder", id: f.id, name: f.name, color: moduleColor(moduleId), sub: `${state.docs.filter((d) => d.folderId === f.id).length} Objekte` }));
    docs = semDocs().filter((d) => d.moduleId === moduleId && d.folderId === folderId);
  }
  if (!recentOnly || q) docs = sortDocs(docs);

  const recent = atRoot && !q ? [...semDocs()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6) : [];

  if (!folders.length && !docs.length && !recent.length) {
    body.innerHTML = `<div class="empty-state"><div class="big">${q ? "🔍" : "🗒"}</div>${
      q ? "Nichts gefunden." : `Noch keine Blätter hier.<br><br><button class="btn primary" id="emptyNew">＋ Neues Blatt</button>`
    }</div>`;
    $("#emptyNew")?.addEventListener("click", () => newSheetDialog({ moduleId: moduleId ?? null, folderId }));
    return;
  }

  const folderTile = (f) =>
    ui.layout === "grid"
      ? `<div class="tile" data-open-${f.type}="${f.id ?? ""}" role="button" tabindex="0">${folderSvg(f.color)}<div class="title">${esc(f.name)}</div><div class="sub">${esc(f.sub)}</div><button class="more" data-more-${f.type}="${f.id ?? ""}">⋯</button></div>`
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

  let html = "";
  if (recent.length) html += `<div class="files-group-title">Zuletzt bearbeitet</div>` + wrap(recent.map(docTile).join(""));
  if (folders.length) html += `<div class="files-group-title">${atRoot ? `Module · ${esc(currentSemester().name)}` : "Ordner"}</div>` + wrap(folders.map(folderTile).join(""));
  if (docs.length) html += `<div class="files-group-title">${q ? "Suchergebnisse" : "Blätter"}</div>` + wrap(docs.map(docTile).join(""));
  body.innerHTML = html;

  const activate = (el, fn) => {
    el.addEventListener("click", (e) => !e.target.closest(".more") && fn());
    el.addEventListener("keydown", (e) => e.key === "Enter" && fn());
  };
  $$("[data-open-doc]", body).forEach((el) => activate(el, () => openDoc(el.dataset.openDoc)));
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
  if (a === "delete" && (await confirmModal("Ordner löschen?", "Die Blätter darin bleiben erhalten und rutschen eine Ebene nach oben.", "Löschen", { danger: true }))) {
    state.docs.forEach((d) => d.folderId === folder.id && (d.folderId = folder.parentId));
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
      ${mod ? `<button data-a="rename">✏️ Umbenennen</button>` : ""}
      <button data-a="export">⤓ Alle Blätter exportieren</button>
      ${mod ? `<button data-a="delete" class="danger">🗑 Modul löschen</button>` : ""}
    </div>`);
  const m = openModal.lastModal;
  $$("[data-a]", m).forEach((b) => (b.onclick = () => m.close(b.dataset.a)));
  const a = await p;
  if (a === "new") return newSheetDialog({ moduleId });
  if (a === "rename") {
    const name = await promptModal("Modul umbenennen", "Name", mod.name);
    if (name) mod.name = name;
  }
  if (a === "export") await exportDialog(sortDocs(semDocs().filter((d) => d.moduleId === moduleId)), moduleName(moduleId));
  if (a === "delete" && (await confirmModal("Modul löschen?", "Die Blätter des Moduls werden nach „Sonstiges“ verschoben.", "Löschen", { danger: true }))) {
    state.docs.forEach((d) => d.moduleId === moduleId && Object.assign(d, { moduleId: null, folderId: null }));
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
let sheetEl = null;
let canvasEl = null;
let resizeObs = null;

function openDoc(id) {
  const doc = docById(id);
  if (!doc) return;
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
  const mod = moduleById(doc.moduleId);
  main.innerHTML = `
    <div class="editor-wrap">
      <div class="toolbar">
        <button class="tb" data-a="back" title="Zur Dateiübersicht">‹ Dateien</button>
        <span class="kind-pill">${KINDS[doc.kind].ico} ${esc(KINDS[doc.kind].label)} · ${esc(moduleName(doc.moduleId))}</span>
        <div class="grow"></div>
        <div class="seg" id="modeSeg" title="Modus">
          <button data-mode="notes">📝 Mitschrift</button>
          <button data-mode="task">✏️ Aufgabe</button>
        </div>
        <div class="seg" id="toolSeg" title="Schrift / Stift (${MOD}+Alt+P)">
          <button data-tool="text">𝐓 Schrift</button>
          <button data-tool="pen">✎ Stift</button>
        </div>
        <select class="input" id="paperSel" style="width:auto" title="Blatt">${Object.entries(PAPERS)
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join("")}</select>
        <button class="tb" data-a="chat" title="Chatbot (${MOD}+K)">💬 Chatbot</button>
        <button class="tb" data-a="export" title="Exportieren">⤓ Export</button>
        <span class="saved-state" id="savedState"></span>
        <button class="btn primary" data-a="save" title="Speichern (${MOD}+S)">Speichern</button>
      </div>
      <div class="subbar" id="subbar"></div>
      <div class="editor-body">
        <div class="canvas-scroll" id="canvasScroll">
          <div class="sheet" id="sheet">
            <div class="sheet-head">
              <div class="module-tag">${esc(mod ? mod.name : "Sonstiges")}${mod?.examType ? ` · ${esc(mod.examType)}` : ""}</div>
              <div class="sheet-date">${esc(fmtLong(Date.now()))}${
                sameDay(doc.createdAt, Date.now()) ? "" : `<small>Erstellt am ${esc(fmtShort(doc.createdAt))}</small>`
              }</div>
            </div>
            <input class="doc-title" id="docTitle" value="${esc(doc.title)}" placeholder="Titel" autocomplete="off" spellcheck="true" autocapitalize="sentences">
            <div class="page-content" id="editor" contenteditable="true" spellcheck="true" autocorrect="on" autocapitalize="sentences" lang="de"
              data-placeholder="Einfach lostippen …   # Überschrift · - Liste · rot = Fachbegriff (${MOD}+Shift+F)"></div>
            <div class="glossary" id="glossary"></div>
            <canvas class="draw-layer" id="drawLayer"></canvas>
          </div>
        </div>
        <aside class="side-panel" id="sidePanel" hidden></aside>
      </div>
    </div>`;

  editorEl = $("#editor", main);
  sheetEl = $("#sheet", main);
  canvasEl = $("#drawLayer", main);
  editorEl.innerHTML = sanitizeHtml(doc.html);
  document.execCommand("defaultParagraphSeparator", false, "p");

  applyDocLook();
  renderModeSeg();
  renderToolSeg();
  renderSubbar();
  renderGlossary();
  renderSidePanel();
  setupCanvas();
  updateSavedState();

  $("#paperSel", main).value = doc.paper;
  $("#paperSel", main).onchange = (e) => {
    doc.paper = e.target.value;
    applyDocLook();
    touchDoc();
  };
  $("#docTitle", main).addEventListener("input", (e) => {
    doc.title = e.target.value;
    touchDoc();
  });
  $("#docTitle", main).addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusEditorStart();
    }
  });
  $$("[data-a]", main.querySelector(".toolbar")).forEach((b) => (b.onclick = () => toolbarAction(b.dataset.a)));

  editorEl.addEventListener("input", onEditorInput);
  editorEl.addEventListener("keydown", onEditorKeydown);
  editorEl.addEventListener("paste", onEditorPaste);
  editorEl.addEventListener("focus", () => {
    if (!editorEl.textContent && !editorEl.querySelector("li, h1, h2, h3")) focusEditorStart();
  });

  if (!doc.html) setTimeout(() => (doc.title ? focusEditorStart() : $("#docTitle").focus()), 30);
}

function applyDocLook() {
  const doc = currentDoc();
  sheetEl.classList.remove("paper-lined", "paper-blank", "paper-grid");
  sheetEl.classList.add(`paper-${doc.paper}`);
  const d = doc.design || {};
  sheetEl.style.setProperty("--page-bg", d.pageColor || "#ffffff");
  sheetEl.style.setProperty("--heading", d.headingColor || "#1c1c1e");
  sheetEl.style.setProperty("--doc-accent", d.accentColor || moduleColor(doc.moduleId));
  const paperSel = $("#paperSel");
  if (paperSel) paperSel.value = doc.paper;
}

function focusEditorStart() {
  editorEl.focus();
  if (!editorEl.firstChild) {
    editorEl.innerHTML = "<p><br></p>";
  }
  const r = document.createRange();
  r.selectNodeContents(editorEl.firstChild);
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
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
  renderToolSeg();
  renderSubbar();
  if (tool === "text") editorEl.focus();
}

// Leiste unter der Werkzeugleiste: Schrift- bzw. Stift-Einstellungen
function renderSubbar() {
  const bar = $("#subbar");
  if (ui.tool === "text") {
    bar.innerHTML = `
      <select id="blockSel" title="Absatzstil (feste Größen)">
        <option value="p">Text</option><option value="h1">Überschrift 1</option><option value="h2">Überschrift 2</option><option value="h3">Überschrift 3</option>
      </select>
      <select id="sizeSel" title="Schriftgröße für Markierung">
        ${[10, 11, 12, 14, 16, 18, 22].map((s) => `<option value="${s}" ${s === state.settings.fontSize ? "selected" : ""}>${s} pt</option>`).join("")}
      </select>
      <span class="divider"></span>
      <button class="tb" data-cmd="bold" title="Fett (${MOD}+B)"><b>B</b></button>
      <button class="tb" data-cmd="italic" title="Kursiv (${MOD}+I)"><i>I</i></button>
      <button class="tb" data-cmd="underline" title="Unterstrichen (${MOD}+U)"><u>U</u></button>
      <span class="divider"></span>
      ${TEXT_COLORS.map(([c, n]) => `<button class="swatch" style="background:${c}" data-color="${c}" title="${n}"></button>`).join("")}
      <button class="tb term-btn" data-cmd="term" title="Fachbegriff rot markieren (${MOD}+Shift+F)">● Fachbegriff</button>
      <span class="divider"></span>
      <button class="tb" data-cmd="insertUnorderedList" title="Stichpunkte (${MOD}+Shift+L)">• Liste</button>
      <button class="tb" data-cmd="insertOrderedList" title="Nummerierung">1. Liste</button>
      <span class="divider"></span>
      <button class="tb" data-cmd="undo" title="Rückgängig (${MOD}+Z)">↶</button>
      <button class="tb" data-cmd="redo" title="Wiederholen">↷</button>
      <span class="divider"></span>
      <span class="saved-state">Schrift: ${esc(state.settings.font)}</span>`;
    $$("[data-cmd]", bar).forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => runCommand(b.dataset.cmd);
    });
    $$("[data-color]", bar).forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => {
        document.execCommand("styleWithCSS", false, true);
        document.execCommand("foreColor", false, b.dataset.color);
        onEditorInput();
      };
    });
    $("#blockSel", bar).onchange = (e) => {
      editorEl.focus();
      setBlock(e.target.value);
    };
    $("#sizeSel", bar).onchange = (e) => applyFontSize(Number(e.target.value));
  } else {
    const pen = ui.pen;
    const colors = pen.kind === "marker" ? MARKER_COLORS : PEN_COLORS;
    if (pen.kind !== "eraser" && !colors.includes(pen.color)) pen.color = colors[0];
    bar.innerHTML = `
      <div class="seg">
        <button data-pen="pen" class="${pen.kind === "pen" ? "on" : ""}">✎ Stift</button>
        <button data-pen="marker" class="${pen.kind === "marker" ? "on" : ""}">▮ Marker</button>
        <button data-pen="eraser" class="${pen.kind === "eraser" ? "on" : ""}">⌫ Radierer</button>
      </div>
      <span class="divider"></span>
      <span title="Dicke">Dicke</span>
      <input type="range" id="penWidth" min="1" max="${pen.kind === "pen" ? 12 : 40}" value="${pen.width}">
      <span class="width-dot" id="widthDot"></span>
      <span class="divider"></span>
      ${pen.kind === "eraser" ? "" : colors.map((c) => `<button class="swatch ${c === pen.color ? "on" : ""}" style="background:${c}" data-pcolor="${c}"></button>`).join("")}
      <label class="swatch" title="Eigene Farbe" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);position:relative;overflow:hidden;${pen.kind === "eraser" ? "display:none" : ""}">
        <input type="color" id="customPen" style="opacity:0;position:absolute;inset:0;width:100%;height:100%;cursor:pointer"></label>
      <span class="divider"></span>
      <button class="tb" data-p="undo" title="Letzten Strich entfernen">↶ Strich</button>
      <button class="tb" data-p="clear" title="Alle Zeichnungen löschen">🗑 Alles löschen</button>`;
    const dot = $("#widthDot", bar);
    const updDot = () => {
      const w = Math.max(3, Math.min(30, pen.width));
      Object.assign(dot.style, { width: w + "px", height: w + "px", color: pen.kind === "eraser" ? "#aeaeb2" : pen.color });
    };
    updDot();
    $$("[data-pen]", bar).forEach(
      (b) =>
        (b.onclick = () => {
          pen.kind = b.dataset.pen;
          pen.width = pen.kind === "pen" ? 3 : pen.kind === "marker" ? 16 : 20;
          renderSubbar();
        })
    );
    $("#penWidth", bar).oninput = (e) => {
      pen.width = Number(e.target.value);
      updDot();
    };
    $$("[data-pcolor]", bar).forEach(
      (b) =>
        (b.onclick = () => {
          pen.color = b.dataset.pcolor;
          renderSubbar();
        })
    );
    $("#customPen", bar).oninput = (e) => {
      const hex = e.target.value;
      if (pen.kind === "marker") {
        const n = parseInt(hex.slice(1), 16);
        pen.color = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0.4)`;
      } else pen.color = hex;
      updDot();
    };
    $("[data-p=undo]", bar).onclick = () => {
      currentDoc().strokes.pop();
      redrawCanvas();
      touchDoc();
    };
    $("[data-p=clear]", bar).onclick = async () => {
      if (await confirmModal("Zeichnungen löschen?", "Alle Stiftstriche auf diesem Blatt werden entfernt.", "Löschen", { danger: true })) {
        currentDoc().strokes = [];
        redrawCanvas();
        touchDoc();
      }
    };
  }
}

function runCommand(cmd) {
  editorEl.focus();
  if (cmd === "term") return toggleTerm();
  document.execCommand("styleWithCSS", false, false);
  document.execCommand(cmd, false, null);
  onEditorInput();
}

function setBlock(tag) {
  const current = currentBlock();
  const isSame = current && current.tagName.toLowerCase() === tag;
  document.execCommand("formatBlock", false, isSame ? "p" : tag);
  onEditorInput();
}

function currentBlock() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  let n = sel.anchorNode;
  while (n && n.parentNode !== editorEl) n = n.parentNode;
  return n && n.nodeType === 1 ? n : null;
}

function applyFontSize(pt) {
  editorEl.focus();
  ui.pendingFontSize = pt;
  document.execCommand("styleWithCSS", false, false);
  document.execCommand("fontSize", false, "7");
  normalizeFonts();
  onEditorInput();
}

// execCommand erzeugt <font>-Tags – wir machen daraus saubere <span>s, Schriftart bleibt immer gleich
function normalizeFonts() {
  for (const f of $$("font", editorEl)) {
    const span = document.createElement("span");
    if (f.getAttribute("size") === "7" && ui.pendingFontSize) span.style.fontSize = ui.pendingFontSize + "pt";
    if (f.getAttribute("color")) span.style.color = f.getAttribute("color");
    span.append(...f.childNodes);
    f.replaceWith(span);
  }
  for (const s of $$('span[style*="xxx-large"]', editorEl)) {
    s.style.fontSize = ui.pendingFontSize ? ui.pendingFontSize + "pt" : "";
  }
}

function toggleTerm() {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.commonAncestorContainer)) return;
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const existing = startEl.closest("span.term");
  if (existing && editorEl.contains(existing)) {
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
    if (block && sel.isCollapsed && !block.closest("ul,ol")) {
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
    else document.execCommand("insertText", false, "    ");
  }
}

function onEditorPaste(e) {
  // Immer als reiner Text einfügen, damit Schriftart & Größe einheitlich bleiben
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  const html = text
    .split(/\r?\n/)
    .map((l) => esc(l))
    .join("<br>");
  document.execCommand("insertHTML", false, html);
}

const onEditorInput = (() => {
  const later = debounce(() => {
    renderGlossary();
    resizeCanvas();
  }, 400);
  return () => {
    normalizeFonts();
    const doc = currentDoc();
    if (!doc) return;
    doc.html = editorEl.innerHTML;
    touchDoc();
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
  el.textContent = text || (pendingBlocks(doc).length && doc.kind !== "block" ? "Gespeichert · nicht verbessert" : "Gespeichert ✓");
}

// ---------- Blöcke & Verbesserung ----------

// Jeder Absatz bekommt eine feste ID, damit nur Bearbeitetes verbessert wird
function normalizeBlocks() {
  if (!editorEl) return;
  unnestBlocks();
  let pendingInline = [];
  const flush = (before) => {
    if (!pendingInline.length) return;
    const p = document.createElement("p");
    editorEl.insertBefore(p, before);
    p.append(...pendingInline);
    pendingInline = [];
  };
  for (const node of [...editorEl.childNodes]) {
    const isBlock = node.nodeType === 1 && /^(P|DIV|H1|H2|H3|UL|OL)$/.test(node.tagName);
    if (isBlock) flush(node);
    else if (node.nodeType === 3 && !node.textContent.trim() && !pendingInline.length) node.remove();
    else pendingInline.push(node);
  }
  flush(null);
  for (const el of editorEl.children) {
    if (el.tagName === "DIV") {
      const p = document.createElement("p");
      p.append(...el.childNodes);
      el.replaceWith(p);
    }
  }
  for (const el of editorEl.children) if (!el.dataset.bid) el.dataset.bid = uid().slice(0, 8);
  currentDoc().html = editorEl.innerHTML;
}

// Vergleich über Text + Fachbegriffe, damit reine Formatierungen nicht als „bearbeitet“ zählen
// Browser verschachteln Listen/Überschriften manchmal in <p> – wieder auf eine Ebene holen
function unnestBlocks() {
  for (const p of [...editorEl.children]) {
    if (/^(P|DIV)$/.test(p.tagName) && p.querySelector(":scope > ul, :scope > ol, :scope > h1, :scope > h2, :scope > h3, :scope > p")) {
      p.replaceWith(...[...p.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim()));
    }
  }
}

const blockHash = (el) => hash(el.tagName + el.textContent + "|" + [...el.querySelectorAll("span.term")].map((t) => t.textContent).join(","));

function blockElements(doc) {
  if (editorEl && ui.docId === doc.id) return [...editorEl.children];
  const box = document.createElement("div");
  box.innerHTML = doc.html;
  return [...box.children];
}

function pendingBlocks(doc) {
  if (!doc) return [];
  return blockElements(doc).filter((el) => el.textContent.trim() && doc.improved[el.dataset.bid] !== blockHash(el));
}

function termsInDoc() {
  const seen = new Map();
  for (const t of $$("span.term", editorEl)) {
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
  if (!ask || !changed.length || doc.declinedSig === sig) {
    updateSavedState();
    toast("Gespeichert ✓");
    return;
  }
  const yes = await confirmModal(
    "Gespeichert ✓ – jetzt verbessern?",
    `Soll ich die ${changed.length === 1 ? "bearbeitete Stelle" : `${changed.length} bearbeiteten Stellen`} verbessern? Rechtschreibung wird korrigiert, Erklärungen werden präzisiert und Fachbegriffe erklärt. Nur Bearbeitetes wird angefasst.`,
    "Ja, verbessern",
    { cancelLabel: "Nein, so lassen" }
  );
  if (!yes) {
    doc.declinedSig = sig;
    persist();
    updateSavedState();
    return;
  }
  await improveDoc(changed);
}

async function improveDoc(changed) {
  const doc = currentDoc();
  const terms = termsInDoc().filter((t) => !doc.glossary[t.toLowerCase()]);
  const busy = toast("✨ Verbessere …", "", 120000);
  const saveBtn = $("[data-a=save]");
  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await api("/api/improve", {
      moduleName: moduleName(doc.moduleId),
      blocks: changed.map((el) => ({ id: el.dataset.bid, html: el.outerHTML.replace(/\sdata-bid="[^"]*"/g, "") })),
      terms,
    });
    if (ui.docId !== doc.id) throw new Error("Blatt wurde gewechselt.");
    let count = 0;
    for (const { id, html } of res.blocks || []) {
      const el = editorEl.querySelector(`:scope > [data-bid="${CSS.escape(id)}"]`);
      if (!el) continue;
      const box = document.createElement("div");
      box.innerHTML = sanitizeHtml(html);
      const replacement = box.children.length === 1 && /^(P|H1|H2|H3|UL|OL)$/.test(box.firstElementChild.tagName) ? box.firstElementChild : null;
      if (replacement) el.replaceWith(replacement);
      else el.innerHTML = box.innerHTML;
      const target = replacement || el;
      target.dataset.bid = id;
      count++;
    }
    mergeGlossary(res.glossary);
    normalizeBlocks();
    for (const el of changed) {
      const now = editorEl.querySelector(`:scope > [data-bid="${CSS.escape(el.dataset.bid)}"]`);
      if (now) doc.improved[now.dataset.bid] = blockHash(now);
    }
    doc.html = editorEl.innerHTML;
    doc.declinedSig = "";
    await writeState();
    renderGlossary();
    updateSavedState();
    toast(`✨ ${count} Stelle(n) verbessert`);
  } catch (err) {
    toast(err.message, "error", 5000);
  } finally {
    busy.remove();
    if (saveBtn) saveBtn.disabled = false;
  }
}

function mergeGlossary(list = []) {
  const doc = currentDoc();
  for (const { term, explanation } of list) {
    if (term && explanation) doc.glossary[term.toLowerCase()] = { term, explanation };
  }
}

// Fachbegriffe stehen auf jedem Blatt unten nochmal mit Erklärung
function renderGlossary() {
  const box = $("#glossary");
  if (!box) return;
  const doc = currentDoc();
  const terms = termsInDoc();
  if (!terms.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const missing = terms.filter((t) => !doc.glossary[t.toLowerCase()]);
  box.innerHTML = `
    <h4>Fachbegriffe</h4>
    <dl>${terms
      .map((t) => {
        const g = doc.glossary[t.toLowerCase()];
        return `<dt class="term-name">${esc(t)}</dt><dd class="${g ? "" : "pending"}">${
          g ? esc(g.explanation) : doc.kind === "block" ? "–" : "Erklärung folgt beim Verbessern"
        }</dd>`;
      })
      .join("")}</dl>
    ${missing.length && doc.kind !== "block" ? `<div class="gl-actions"><button id="explainNow">Jetzt erklären</button></div>` : ""}`;
  $("#explainNow", box)?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Erkläre …";
    try {
      const res = await api("/api/glossary", { moduleName: moduleName(doc.moduleId), terms: missing, context: editorEl.innerText });
      mergeGlossary(res.glossary);
      persist();
    } catch (err) {
      toast(err.message, "error", 5000);
    }
    renderGlossary();
  });
}

async function toolbarAction(a) {
  if (a === "back") {
    await leaveEditor();
    renderAll();
  }
  if (a === "save") saveDoc({ ask: true });
  if (a === "chat") {
    ui.panel = ui.panel === "chat" ? (currentDoc().mode === "task" ? "task" : null) : "chat";
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
  if (!doc.html.trim() && !doc.strokes.length && doc.title === `${KINDS[doc.kind].label} ${fmtShort(doc.createdAt)}`) {
    state.docs = state.docs.filter((d) => d.id !== doc.id); // leeres Blatt nicht aufheben
    await writeState();
  } else {
    await saveDoc({ ask: true });
  }
  resizeObs?.disconnect();
  editorEl = sheetEl = canvasEl = null;
  ui.view = "files";
  if (moduleById(doc.moduleId) || doc.moduleId === null) ui.loc = { moduleId: doc.moduleId, folderId: doc.folderId };
}

// ---------- Stift / Zeichnen ----------

function setupCanvas() {
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(() => resizeCanvas());
  resizeObs.observe(sheetEl);
  resizeCanvas();

  let current = null;
  let sawPen = false;
  const pointFrom = (e) => {
    const rect = sheetEl.getBoundingClientRect();
    const W = rect.width;
    return [(e.clientX - rect.left) / W, (e.clientY - rect.top) / W];
  };
  canvasEl.addEventListener("pointerdown", (e) => {
    if (ui.tool !== "pen") return;
    if (e.pointerType === "pen") sawPen = true;
    if (e.pointerType === "touch" && sawPen) return; // Handballen ignorieren
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    const { kind, color, width } = ui.pen;
    current = { kind, color: kind === "eraser" ? "#000" : color, width, points: [pointFrom(e)] };
    drawStroke(canvasEl.getContext("2d"), current, sheetEl.clientWidth);
  });
  canvasEl.addEventListener("pointermove", (e) => {
    if (!current) return;
    const pts = current.points;
    pts.push(pointFrom(e));
    drawSegment(canvasEl.getContext("2d"), current, sheetEl.clientWidth, pts.length - 2);
  });
  const end = () => {
    if (!current) return;
    currentDoc().strokes.push(current);
    current = null;
    redrawCanvas();
    touchDoc();
  };
  canvasEl.addEventListener("pointerup", end);
  canvasEl.addEventListener("pointercancel", end);
}

function resizeCanvas() {
  if (!canvasEl || !sheetEl) return;
  const dpr = window.devicePixelRatio || 1;
  const w = sheetEl.clientWidth;
  const h = sheetEl.offsetHeight;
  if (canvasEl.width !== Math.round(w * dpr) || canvasEl.height !== Math.round(h * dpr)) {
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    canvasEl.style.width = w + "px";
    canvasEl.style.height = h + "px";
    redrawCanvas();
  }
}

function redrawCanvas() {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  for (const s of currentDoc().strokes) drawStroke(ctx, s, sheetEl.clientWidth);
}

function strokeStyle(ctx, s, W) {
  ctx.globalCompositeOperation = s.kind === "eraser" ? "destination-out" : s.kind === "marker" ? "multiply" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineWidth = (s.width * W) / SHEET_BASE_WIDTH;
  ctx.lineCap = s.kind === "marker" ? "butt" : "round";
  ctx.lineJoin = "round";
}

function drawStroke(ctx, s, W) {
  ctx.save();
  strokeStyle(ctx, s, W);
  const pts = s.points.map(([x, y]) => [x * W, y * W]);
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
  ctx.beginPath();
  ctx.moveTo(a[0] * W, a[1] * W);
  ctx.lineTo(b[0] * W, b[1] * W);
  ctx.stroke();
  ctx.restore();
}

function renderStrokesToDataUrl(doc) {
  if (!doc.strokes?.length) return null;
  const W = SHEET_BASE_WIDTH;
  const maxY = Math.max(...doc.strokes.flatMap((s) => s.points.map((p) => p[1])));
  const c = document.createElement("canvas");
  c.width = W * 2;
  c.height = Math.ceil((maxY * W + 40) * 2);
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);
  for (const s of doc.strokes) drawStroke(ctx, s, W);
  return { url: c.toDataURL("image/png"), height: c.height / 2 };
}

// ---------- Rechte Seitenleiste: Chatbot & Aufgaben-Modus ----------

function renderSidePanel() {
  const panel = $("#sidePanel");
  if (!panel) return;
  panel.hidden = !ui.panel;
  $$("[data-a=chat]").forEach((b) => b.classList.toggle("on", ui.panel === "chat"));
  if (!ui.panel) return;
  const doc = currentDoc();
  if (ui.panel === "chat") {
    panel.innerHTML = `<div class="panel-head">💬 Chatbot <button class="icon-btn" data-close>✕</button></div><div class="chat-box" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`;
    mountChat($(".chat-box", panel), {
      mode: "document",
      history: doc.chat,
      hints: ["Fehler korrigieren & glätten", "Übersichtlicher strukturieren", "Zusammenfassung ans Ende", "Design: dezent & modern", "Design: kariert, Akzent Blau"],
      placeholder: "Was soll ich an der Datei ändern?",
      payload: () => {
        normalizeBlocks();
        return { moduleName: moduleName(doc.moduleId), documentHtml: `<h1>${esc(doc.title)}</h1>` + stripBids(doc.html) };
      },
      onResult: documentChatResult,
    });
  } else {
    panel.innerHTML = `
      <div class="panel-head">✏️ Aufgaben-Modus <button class="icon-btn" data-close>✕</button></div>
      <div class="panel-body" style="flex:0 0 auto;border-bottom:1px solid var(--border)">
        <label class="field"><span>Aufgabe hier eingeben</span><textarea class="input" id="taskText" placeholder="z. B. Analysieren Sie … / Diskutieren Sie …">${esc(doc.task)}</textarea></label>
        <div class="task-choice">
          <button class="btn" data-t="ideas"><b>💡 Ideen vom Chatbot</b><small>Ansätze & Denkanstöße bekommen</small></button>
          <button class="btn" data-t="solve"><b>🤖 Chatbot löst die Aufgabe</b><small>Kompletter Lösungsvorschlag</small></button>
          <button class="btn" data-t="self"><b>✍️ Selbst machen</b><small>Aufgabe ins Blatt, weiter in Stichpunkten</small></button>
        </div>
      </div>
      <div class="chat-box" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`;
    const taskText = $("#taskText", panel);
    taskText.oninput = () => {
      doc.task = taskText.value;
      persist();
    };
    const chat = mountChat($(".chat-box", panel), {
      mode: "task",
      history: (doc.taskChat ||= []),
      hints: [],
      placeholder: "Rückfrage zur Aufgabe …",
      payload: () => ({ moduleName: moduleName(doc.moduleId), documentHtml: stripBids(doc.html).slice(0, 20000) }),
      onResult: taskChatResult,
    });
    $$("[data-t]", panel).forEach(
      (b) =>
        (b.onclick = () => {
          const task = taskText.value.trim();
          if (!task) {
            taskText.focus();
            return toast("Gib zuerst die Aufgabe ein.");
          }
          if (b.dataset.t === "self") return startSelfMode(task);
          chat.send(b.dataset.t === "ideas" ? `Aufgabe: ${task}\n\nGib mir Ideen und Ansätze, ich will sie selbst lösen.` : `Aufgabe: ${task}\n\nBitte löse die Aufgabe vollständig.`);
        })
    );
  }
  $("[data-close]", panel).onclick = () => {
    if (ui.panel === "task") {
      doc.mode = "notes";
      renderModeSeg();
    }
    ui.panel = null;
    persist();
    renderSidePanel();
  };
}

const stripBids = (html) => html.replace(/\sdata-bid="[^"]*"/g, "");

function documentChatResult(res, msgEl) {
  const doc = currentDoc();
  const actions = [];
  if (res.documentHtml) {
    const html = sanitizeHtml(res.documentHtml.replace(/^\s*<h1>[\s\S]*?<\/h1>/, (m) => (m.includes(doc.title) ? "" : m)));
    actions.push([
      "✓ Übernehmen",
      () => {
        const before = doc.html;
        replaceDocHtml(html);
        const t = toast("Übernommen – „Rückgängig“ im Chat möglich");
        return ["↶ Rückgängig", () => (replaceDocHtml(before), t.remove())];
      },
    ]);
  }
  if (res.design) {
    const prev = { ...doc.design, paper: doc.paper };
    const { paper, ...colors } = res.design;
    for (const [k, v] of Object.entries(colors)) if (v) doc.design[k] = v;
    if (paper) doc.paper = paper;
    applyDocLook();
    persist();
    actions.push([
      "↶ Design zurücksetzen",
      () => {
        const { paper: oldPaper, ...oldColors } = prev;
        doc.design = oldColors;
        doc.paper = oldPaper;
        applyDocLook();
        persist();
      },
    ]);
  }
  addMsgActions(msgEl, actions);
}

function taskChatResult(res, msgEl) {
  const actions = [];
  if (res.taskIdeas?.length) {
    const ul = document.createElement("ul");
    ul.className = "idea-list";
    for (const idea of res.taskIdeas) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${esc(idea)}</span><button class="btn" title="Ins Blatt">＋</button>`;
      li.querySelector("button").onclick = (e) => {
        appendHtml(`<ul><li>${esc(idea)}</li></ul>`);
        e.target.disabled = true;
      };
      ul.appendChild(li);
    }
    msgEl.appendChild(ul);
    actions.push(["Alle als Stichpunkte einfügen", () => appendHtml(`<ul>${res.taskIdeas.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`)]);
  }
  if (res.documentHtml) {
    const html = sanitizeHtml(res.documentHtml);
    const prev = document.createElement("div");
    prev.className = "solution-preview";
    prev.innerHTML = html;
    msgEl.appendChild(prev);
    actions.push(["In Datei einfügen", () => appendHtml(html)]);
  }
  addMsgActions(msgEl, actions);
}

function addMsgActions(msgEl, actions) {
  if (!actions.length) return;
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  for (const [label, fn] of actions) {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = label;
    b.onclick = () => {
      const follow = fn();
      if (Array.isArray(follow)) {
        b.textContent = follow[0];
        b.onclick = () => (follow[1](), b.remove());
      } else b.disabled = true;
    };
    bar.appendChild(b);
  }
  msgEl.appendChild(bar);
}

function replaceDocHtml(html) {
  const doc = currentDoc();
  editorEl.innerHTML = html;
  normalizeBlocks();
  // Vom Chatbot erstellte Fassung gilt als verbessert – es wird nicht nochmal gefragt
  doc.improved = {};
  for (const el of editorEl.children) doc.improved[el.dataset.bid] = blockHash(el);
  doc.html = editorEl.innerHTML;
  touchDoc();
  renderGlossary();
}

function appendHtml(html) {
  editorEl.insertAdjacentHTML("beforeend", html);
  onEditorInput();
  normalizeBlocks();
  editorEl.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// "Selbst machen": Aufgabe ins Blatt schreiben und direkt in Stichpunkte springen
function startSelfMode(task) {
  setTool("text");
  editorEl.insertAdjacentHTML(
    "beforeend",
    `<h2>Aufgabe</h2><p>${esc(task).replace(/\n/g, "<br>")}</p><h3>Meine Lösung</h3><ul><li><br></li></ul>`
  );
  const li = editorEl.querySelector("ul:last-child li:last-child");
  editorEl.focus();
  const r = document.createRange();
  r.setStart(li, 0);
  r.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  li.scrollIntoView({ behavior: "smooth", block: "center" });
  onEditorInput();
}

// ---------- Wiederverwendbarer Chat ----------

function mountChat(container, { mode, history, hints = [], placeholder = "", payload = () => ({}), onResult = () => {} }) {
  container.innerHTML = `
    <div class="panel-body"><div class="chat-hints">${hints.map((h) => `<button class="chip">${esc(h)}</button>`).join("")}</div><div class="chat-log"></div></div>
    <div class="chat-input"><textarea class="input" rows="1" placeholder="${esc(placeholder)}"></textarea><button class="btn primary">↑</button></div>`;
  const log = $(".chat-log", container);
  const scroller = $(".panel-body", container);
  const input = $("textarea", container);
  const bubble = (role, text) => {
    const el = document.createElement("div");
    el.className = `msg ${role === "user" ? "user" : "bot"}`;
    el.textContent = text;
    log.appendChild(el);
    scroller.scrollTop = scroller.scrollHeight;
    return el;
  };
  for (const m of history) bubble(m.role, m.text);
  if (!history.length) {
    bubble("bot", {
      document: "Hi! Sag mir, was dir an der Datei nicht gefällt oder welches Design du möchtest – ich passe sie an.",
      task: "Gib oben die Aufgabe ein und wähl, ob du Ideen, eine Lösung oder selbst loslegen möchtest.",
      timetable: "Lade Screenshots deines Stundenplans hoch, dann lese ich die Module aus. Sag mir auch, wo du eine Klausur schreibst, eine Hausarbeit oder nur eine Präsentation hältst.",
    }[mode]);
  }

  let busy = false;
  async function send(text, extra = {}) {
    if (busy || !text.trim()) return;
    busy = true;
    const prior = history.slice(-12);
    history.push({ role: "user", text });
    bubble("user", text);
    const thinking = bubble("bot", "Denke nach …");
    thinking.classList.add("thinking");
    try {
      const res = await api("/api/chat", { mode, history: prior, message: text, ...payload(), ...extra });
      thinking.remove();
      history.push({ role: "bot", text: res.reply });
      if (history.length > 40) history.splice(0, history.length - 40);
      const el = bubble("bot", res.reply);
      onResult(res, el);
      scroller.scrollTop = scroller.scrollHeight;
    } catch (err) {
      thinking.textContent = "⚠️ " + err.message;
      thinking.classList.remove("thinking");
      history.pop();
    } finally {
      busy = false;
      persist();
    }
  }
  const submit = () => {
    const t = input.value;
    input.value = "";
    send(t);
  };
  $(".chat-input button", container).onclick = submit;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  });
  $$(".chip", container).forEach((c) => (c.onclick = () => send(c.textContent)));
  return { send };
}

// ============================================================
// Stundenplan & Module
// ============================================================

function renderTimetable(main) {
  const sem = currentSemester();
  sem.timetable ||= { images: [], chat: [] };
  const tt = sem.timetable;
  main.innerHTML = `
    <div class="files-head"><div class="crumbs"><button>Stundenplan &amp; Module</button></div><span class="kind-pill">${esc(sem.name)}</span></div>
    <div class="tt-wrap"><div class="tt-grid">
      <div class="card">
        <h2>📅 Stundenplan scannen</h2>
        <p class="hint">Screenshots hier ablegen, einfügen (${MOD}+V) oder auswählen. Danach erkennt der Chatbot automatisch deine Module.</p>
        <div class="dropzone" id="dropzone">Bilder hierher ziehen oder <button class="btn" id="pickImg">Auswählen</button>
          <input type="file" id="imgInput" accept="image/*" multiple hidden></div>
        <div class="thumbs" id="thumbs"></div>
        <div style="margin:12px 0 16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="scanBtn">🔍 Module erkennen</button>
        </div>
        <div class="tt-chat" id="ttChat"></div>
      </div>
      <div class="card">
        <h2>🎓 Meine Module</h2>
        <p class="hint">Alle Module dieses Semesters. Farbe antippen zum Ändern.</p>
        <table class="module-table"><thead><tr><th>Farbe</th><th>Modul</th><th>Prüfungsform</th><th></th></tr></thead><tbody id="modBody"></tbody></table>
        <div style="margin-top:12px;display:flex;gap:8px"><input class="input" id="newModName" placeholder="Neues Modul …"><button class="btn" id="newModBtn">＋</button></div>
        <datalist id="examTypes">${EXAM_TYPES.map((t) => `<option value="${t}">`).join("")}</datalist>
      </div>
    </div></div>`;

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
    for (const f of files) if (f.type.startsWith("image/")) tt.images.push(await downscaleImage(f));
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

  const chat = mountChat($("#ttChat"), {
    mode: "timetable",
    history: tt.chat,
    hints: ["Welche Module hast du erkannt?", "Statistik ist eine Klausur", "In Soziologie halte ich nur eine Präsentation"],
    placeholder: "z. B. „Methoden ist eine Hausarbeit“",
    payload: () => ({ modules: semModules().map((m) => ({ name: m.name, examType: m.examType })) }),
    onResult: (res, el) => {
      const added = [];
      for (const m of res.addModules || []) {
        if (!m.name?.trim() || findModule(m.name)) continue;
        added.push(addModule(m.name, { examType: m.examType || "", color: m.color || undefined }).name);
      }
      let updated = 0;
      for (const m of res.updateModules || []) {
        const mod = findModule(m.name);
        if (!mod) continue;
        if (m.examType) mod.examType = m.examType;
        if (m.color && /^#[0-9a-f]{6}$/i.test(m.color)) mod.color = m.color;
        updated++;
      }
      persist();
      renderSidebar();
      renderModuleTable();
      if (added.length || updated) {
        const note = document.createElement("div");
        note.className = "msg-actions";
        note.textContent = [added.length ? `＋ ${added.length} Modul(e) hinzugefügt` : "", updated ? `✓ ${updated} aktualisiert` : ""].filter(Boolean).join(" · ");
        el.appendChild(note);
      }
    },
  });
  $("#scanBtn").onclick = () => {
    if (!tt.images.length) return toast("Füge zuerst einen Screenshot deines Stundenplans hinzu.");
    chat.send("Bitte lies alle Module aus meinem Stundenplan aus.", { images: tt.images });
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

const EXPORT_CSS = `
  body { margin: 0; background: #f2f2f7; font-family: var(--doc-font); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 794px; margin: 24px auto; background: var(--page-bg, #fff); color: #1c1c1e; padding: 56px 72px 48px; position: relative; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: var(--doc-size); page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .sheet-head { display: flex; justify-content: space-between; margin-bottom: 18px; }
  .module-tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--doc-accent); }
  .sheet-date { text-align: right; font-size: 11pt; color: #3a3a3c; }
  .doc-title, h1 { font-size: 20pt; font-weight: 700; line-height: 56px; margin: 0; color: var(--heading); }
  h2 { font-size: 15pt; font-weight: 700; line-height: 42px; margin: 0; color: var(--heading); }
  h3 { font-size: 12.5pt; font-weight: 700; line-height: 28px; margin: 0; color: var(--heading); }
  .page-content { line-height: 28px; }
  .page-content p { margin: 0; min-height: 28px; }
  ul, ol { margin: 0; padding-left: 26px; }
  .paper-lined .page-content { background-image: linear-gradient(to bottom, transparent 27px, #c9dcef 27px); background-size: 100% 28px; }
  .paper-grid .page-content { background-image: linear-gradient(to bottom, transparent 19px, #dfe6ee 19px), linear-gradient(to right, transparent 19px, #dfe6ee 19px); background-size: 20px 20px; }
  span.term, .term-name { color: #e0201b; font-weight: 600; }
  .drawing { position: absolute; left: 0; top: 0; width: 794px; pointer-events: none; }
  .glossary { margin-top: 36px; border-top: 2px solid var(--doc-accent); padding-top: 12px; font-size: 10.5pt; line-height: 1.5; }
  .glossary h4 { margin: 0 0 8px; font-size: 11pt; text-transform: uppercase; letter-spacing: .6px; }
  .glossary dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
  .glossary dd { margin: 0; }
  @page { size: A4; margin: 0; }
  @media print { body { background: none; } .sheet { margin: 0; box-shadow: none; } }`;

function docTerms(doc) {
  const box = document.createElement("div");
  box.innerHTML = doc.html;
  const map = new Map();
  for (const t of box.querySelectorAll("span.term")) {
    const term = t.textContent.trim().replace(/[.,;:!?]+$/, "");
    if (term && !map.has(term.toLowerCase())) map.set(term.toLowerCase(), term);
  }
  return [...map.values()].map((t) => ({ term: t, explanation: doc.glossary?.[t.toLowerCase()]?.explanation || "" }));
}

function docToSheetHtml(doc) {
  const d = doc.design || {};
  const drawing = renderStrokesToDataUrl(doc);
  const terms = docTerms(doc);
  const style = `--page-bg:${d.pageColor || "#fff"};--heading:${d.headingColor || "#1c1c1e"};--doc-accent:${d.accentColor || moduleColor(doc.moduleId)};${
    drawing ? `min-height:${Math.max(1123, drawing.height)}px` : ""
  }`;
  return `<section class="sheet paper-${doc.paper}" style="${esc(style)}">
    <div class="sheet-head"><div class="module-tag">${esc(moduleName(doc.moduleId))}</div><div class="sheet-date">${esc(fmtLong(doc.createdAt))}</div></div>
    <h1 class="doc-title">${esc(doc.title)}</h1>
    <div class="page-content">${stripBids(sanitizeHtml(doc.html))}</div>
    ${
      terms.length
        ? `<div class="glossary"><h4>Fachbegriffe</h4><dl>${terms.map((t) => `<dt class="term-name">${esc(t.term)}</dt><dd>${esc(t.explanation || "–")}</dd>`).join("")}</dl></div>`
        : ""
    }
    ${drawing ? `<img class="drawing" src="${drawing.url}" alt="">` : ""}
  </section>`;
}

function exportHtmlDocument(docs, name) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(name)}</title>
    <style>:root{--doc-font:${FONTS[state.settings.font]};--doc-size:${state.settings.fontSize}pt}${EXPORT_CSS}</style></head>
    <body>${docs.map(docToSheetHtml).join("")}</body></html>`;
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
    `# ${doc.title}`,
    `_${moduleName(doc.moduleId)} · ${fmtLong(doc.createdAt)}_`,
    htmlToMarkdown(stripBids(doc.html)),
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

function exportDocs(docs, fmt, name) {
  const file = safeFileName(name);
  if (fmt === "pdf") {
    const w = window.open("", "_blank");
    if (!w) return toast("Pop-up wurde blockiert – bitte erlauben.", "error");
    w.document.write(exportHtmlDocument(docs, name));
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 500);
    return;
  }
  if (fmt === "html") return download(`${file}.html`, exportHtmlDocument(docs, name), "text/html");
  if (fmt === "doc") {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(name)}</title>
      <style>body{font-family:${FONTS[state.settings.font]};font-size:${state.settings.fontSize}pt} h1{font-size:20pt} h2{font-size:15pt} h3{font-size:12.5pt} .term,.term-name{color:#e0201b;font-weight:bold}</style></head><body>
      ${docs
        .map((d, i) => {
          const terms = docTerms(d);
          const drawing = renderStrokesToDataUrl(d);
          return `${i ? '<br style="page-break-before:always">' : ""}<p style="text-align:right;color:#666">${esc(moduleName(d.moduleId))} · ${esc(fmtLong(d.createdAt))}</p>
            <h1>${esc(d.title)}</h1>${stripBids(sanitizeHtml(d.html))}
            ${drawing ? `<p><img src="${drawing.url}" width="600"></p>` : ""}
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
    <p class="lead">Schriftart und Überschriften sind in allen Blättern einheitlich.</p>
    <label class="field"><span>Schriftart (überall gleich)</span><select class="input" id="setFont">${Object.keys(FONTS)
      .map((f) => `<option ${f === s.font ? "selected" : ""} style="font-family:${FONTS[f]}">${f}</option>`)
      .join("")}</select></label>
    <label class="field"><span>Schriftgröße</span><select class="input" id="setSize">${[11, 12]
      .map((n) => `<option value="${n}" ${n === s.fontSize ? "selected" : ""}>${n} pt</option>`)
      .join("")}</select></label>
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
        <kbd>${MOD}+K</kbd><span>Chatbot öffnen</span>
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

function applySettings() {
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
  } else if (key === "k") {
    e.preventDefault();
    toolbarAction("chat");
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
  applySettings();
  renderAll();
})();
