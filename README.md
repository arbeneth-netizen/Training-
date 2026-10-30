# Notizheft – Notizen für die Uni

Eine eigene Notiz-Website im Stil von Apple Pages, gebaut fürs schnelle Schreiben mit der Tastatur.

## Starten

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # für die KI-Funktionen
npm start
```

Dann im Browser **http://localhost:3000** öffnen.

Ohne API-Schlüssel funktioniert alles außer den KI-Funktionen (Verbessern, Fachbegriffe erklären, Stundenplan scannen, Chatbot).

## Funktionen

| Bereich | Was es macht |
|---|---|
| **Semester** (oben rechts) | Wechsel z. B. zwischen „WiSe 2026/2027“ und „SoSe 2027“. Jedes Semester hat eigene Module, Ordner und Blätter, alte und neue Sachen bleiben also getrennt. |
| **Module** (links) | Alle Module mit eigener Farbe (auf den Punkt tippen). Ein Klick auf ein Modul fragt: Schnellnotiz, Mitschrift, Aufgabe oder Collegeblock, dazu liniertes, normales oder kariertes Blatt. „Sonstiges“ ist für alles außerhalb der Uni. |
| **Dateien** | Übersicht wie bei Apple Dateien: Ordner, Symbol- oder Listenansicht, Suche. Die Sortierung läuft automatisch (zuletzt bearbeitet, erstellt, Name oder Art). Mit **＋** legst du Blätter, Ordner oder Module an oder importierst Dateien. |
| **Schreiben** | Schriftart überall gleich (nur Uni-Schriften: Arial, Times New Roman, Calibri, Cambria, Garamond). Überschriften haben immer dieselbe Größe und Dicke. Das Datum steht oben rechts. Die Autokorrektur des Geräts ist aktiv (iOS/macOS). |
| **Fachbegriffe** | Markieren und **●&nbsp;Fachbegriff** wählen (oder ⌘/Strg+Shift+F): Das Wort wird rot. Unten auf dem Blatt erscheinen alle Fachbegriffe mit Erklärung. |
| **Schrift / Stift** | Beim Umschalten erscheinen sofort die passenden Einstellungen: Größe und Farbe für Schrift, Dicke, Farbe, Marker und Radierer für den Stift. |
| **Speichern → Verbessern** | Nach jedem Speichern fragt die App einmal, ob verbessert werden soll (Rechtschreibung, präzisere Erklärungen). Danach fragt sie erst wieder, wenn du etwas änderst, und verbessert nur die geänderten Stellen. Sagst du „Nein“, fragt sie bis zur nächsten Änderung nicht noch einmal. **Collegeblöcke werden nie verarbeitet.** |
| **Mitschrift- / Aufgaben-Modus** | Im Aufgaben-Modus gibst du die Aufgabe ein und wählst: 💡 Ideen vom Chatbot, 🤖 Lösungsvorschlag oder ✍️ selbst machen (die Aufgabe kommt ins Blatt und du schreibst direkt in Stichpunkten weiter). |
| **Chatbot** | Ändert eine Datei, wenn du nicht zufrieden bist („übersichtlicher“, „kürzer“ …), und gestaltet Designs pro Datei (Farben, Blattart). Änderungen kannst du rückgängig machen. |
| **Stundenplan** | Screenshots ablegen oder einfügen; die Module werden automatisch erkannt. Im Chat sagst du, wo eine Klausur, eine Hausarbeit oder nur eine Präsentation ansteht. |
| **Export** | PDF, Word (.doc), Markdown, Text oder HTML, für einzelne Blätter, ganze Ordner oder ganze Module. |

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| ⌘/Strg + S | Speichern (danach Frage nach dem Verbessern) |
| ⌘/Strg + Shift + F | Fachbegriff (rot) |
| ⌘⌥ 1/2/3 (Mac) · Strg+Shift+1/2/3 | Überschrift 1/2/3 (0 = normaler Text) |
| ⌘/Strg + Shift + L | Stichpunkte |
| ⌘/Strg + Alt + P | Schrift ↔ Stift |
| ⌘/Strg + K | Chatbot |
| ⌘/Strg + Alt + N | Neues Blatt |
| `# ` / `## ` am Zeilenanfang | Überschrift |
| `- ` / `1. ` am Zeilenanfang | Liste / Nummerierung |
| Tab / Shift+Tab | In Listen ein- und ausrücken |

## Technik

- `server.js`: kleiner Node-Server, liefert die Website aus und spricht über das offizielle Anthropic SDK mit Claude (Modell `claude-opus-5-5`). Der API-Schlüssel bleibt auf dem Server.
- `public/`: die Website (HTML/CSS/JS, ohne Build-Schritt).
- Daten liegen lokal im Browser (IndexedDB). In den Einstellungen gibt es ein Backup zum Herunterladen und Laden, bis der Uni-Speicher angebunden ist.
