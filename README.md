# Notizheft – Notizen für die Uni

Eine eigene Notiz-Website im Stil von Apple Pages, gebaut fürs schnelle Schreiben mit der Tastatur. **Alles ist kostenlos**: Es gibt keine kostenpflichtigen Dienste und keinen API-Schlüssel.

## Starten

```bash
npm install
export APP_PASSWORD=dein-passwort     # optional: Passwortschutz
npm start
```

Dann im Browser **http://localhost:3000** öffnen.

Ist `APP_PASSWORD` gesetzt, zeigt die Seite zuerst eine Passwortabfrage. Nach der Anmeldung merkt sich der Browser das ein Jahr lang. Online (z. B. bei Render) immer ein Passwort setzen.

## Funktionen

| Bereich | Was es macht |
|---|---|
| **Semester** (oben rechts) | Wechsel z. B. zwischen „WiSe 2026/2027“ und „SoSe 2027“. Jedes Semester hat eigene Module, Ordner und Blätter. |
| **Module** (links) | Alle Module mit eigener Farbe. Ein Klick auf ein Modul fragt: Schnellnotiz, Mitschrift, Aufgabe oder Collegeblock, dazu liniertes, normales oder kariertes Blatt. „Sonstiges“ ist für alles außerhalb der Uni. |
| **Dateien** | Übersicht wie bei Apple Dateien: Ordner, Symbol- oder Listenansicht, Suche, automatische Sortierung. Mit **＋** legst du Blätter, Ordner oder Module an oder importierst Dateien. |
| **Schreiben** | Schriftart überall gleich (Arial, Times New Roman, Calibri, Cambria, Garamond). Überschriften haben immer dieselbe Größe und Dicke. Das Datum steht oben rechts. Die Autokorrektur des iPads ist aktiv. |
| **Speichern → Verbessern** | Nach dem Speichern fragt die App einmal, ob verbessert werden soll: Rechtschreibung & Grammatik (über [LanguageTool](https://languagetool.org), jede Korrektur zum Abhaken) und Formatierung aufräumen. Danach fragt sie erst wieder, wenn du etwas änderst, und prüft dann nur das Geänderte. Rote Fachbegriffe werden nie „korrigiert“. **Collegeblöcke werden nie verarbeitet.** |
| **✨ Aufräumen** | Fürs ganze Blatt: Rechtschreibung, doppelte Leerzeichen, Satzanfänge groß, „Anführungszeichen“, → Pfeile, Zeilen mit „-“ werden Listen, „Punkte:“ vor einer Liste wird Zwischenüberschrift, leere Zeilen weg, auf Wunsch Inhaltsübersicht oben. |
| **Fachbegriffe** | Markieren und **●&nbsp;Fachbegriff** (oder ⌘/Strg+Shift+F): Das Wort wird rot und steht unten im Glossar. Die Erklärung tippst du direkt dort ein, mit Links zu Duden, DWDS, Gabler, Spektrum, bpb, Google Scholar und Wikipedia. Hast du denselben Begriff schon in einem anderen Blatt erklärt, wird die Erklärung übernommen. |
| **Aufgaben-Modus** | Aufgaben eintippen, Anzahl der Aufgaben und Unteraufgaben (a, b, c …) wählen. Die Antwortform wird aus dem Operator erkannt („erörtern“ → Erörterung, „nennen“ → Stichpunkte, „vergleichen“ → Vergleich …) und ist änderbar. „Vorlage einfügen“ baut eine fertige Schablone ins Blatt, die du nur noch ausfüllst. |
| **🎨 Design** | Fertige Designs (Klassisch, Blau, Grün, Warm, Rosé, Lila, Minimal, Papier), eigene Farben, Blattart, auf Wunsch für alle Blätter eines Moduls. |
| **Schrift / Stift** | Beim Umschalten erscheinen sofort die passenden Einstellungen: Größe und Farbe für Schrift, Dicke, Farbe, Marker und Radierer für den Stift. |
| **Stundenplan** | Screenshots ablegen, die Texterkennung ([Tesseract](https://tesseract.projectnaptha.com)) läuft auf dem Gerät. Erkannte Zeilen anhaken, Namen korrigieren, hinzufügen. Prüfungsform pro Modul auswählen. |
| **Export** | PDF, Word (.doc), Markdown, Text oder HTML, für einzelne Blätter, ganze Ordner oder ganze Module. |

Für die Rechtschreibprüfung und die Texterkennung braucht es Internet; dabei wird der Text an LanguageTool geschickt bzw. die Texterkennung einmalig geladen.

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| ⌘/Strg + S | Speichern (danach Frage nach dem Verbessern) |
| ⌘/Strg + Shift + F | Fachbegriff (rot) |
| ⌘⌥ 1/2/3 (Mac) · Strg+Shift+1/2/3 | Überschrift 1/2/3 (0 = normaler Text) |
| ⌘/Strg + Shift + L | Stichpunkte |
| ⌘/Strg + Alt + P | Schrift ↔ Stift |
| ⌘/Strg + Alt + N | Neues Blatt |
| `# ` / `## ` am Zeilenanfang | Überschrift |
| `- ` / `1. ` am Zeilenanfang | Liste / Nummerierung |
| Tab / Shift+Tab | In Listen ein- und ausrücken |

## Technik

- `server.js`: kleiner Node-Server ohne Abhängigkeiten, liefert die Website aus und fragt optional das Passwort ab.
- `public/`: die Website (HTML/CSS/JS, ohne Build-Schritt).
- Daten liegen lokal im Browser (IndexedDB). In den Einstellungen gibt es ein Backup zum Herunterladen und Laden, bis der Uni-Speicher angebunden ist.
