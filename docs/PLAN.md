# Horario Espiritual — PWA rebuild plan

Simplified rebuild of the SwiftUI app at `~/Documents/horario-espiritual/` as an installable
web app (PWA) for Alfredo's own iPhone. No App Store, no signing, no weekly re-install.

Read this file first when resuming. Update the **Status** checklist after each step.

## 1. Context (from the old app; the original chat transcript was purged)

- Domain: the Schoenstatt "Horario Espiritual" (Fr. Joseph Kentenich's self-education tool):
  a personal list of spiritual practices ("puntos" / here "resoluciones") at daily, weekly and
  monthly frequency, reviewed monthly (often with a spiritual director → hence the PDF).
- "Examen particular" / "Propósito particular": ONE special resolution graded every day.
  Old app graded 0–5 with labels; new app grades **1–5**.
- Old app had: Schoenstatt template catalog (~25 pre-filled points), 4 "relationship"
  categories, quarterly/yearly frequencies, day-of-week/month scheduling, icons, colours,
  gratitude/providence day logs, streaks, charts, 3 languages. **All of that is dropped.**
- Old bundle id `com.alfredoschoch.HorarioEspiritual`; old backup JSON has PracticeDTO /
  CompletionDTO / ResolutionDTO / EntryDTO (see `Services/Backup.swift`) — an importer is an
  optional follow-up, not in scope.

## 2. Requirements (Alfredo, 2026-09-01)

1. Set and modify daily, weekly and monthly resolutions.
2. Track daily / weekly / monthly accomplishment of each (yes/no checkbox).
3. Define the special resolution (examen particular) and track it with a 1–5 score per day.
4. Export the monthly final view as a PDF to share.
5. View and export previous months.
6. Resolutions added later do NOT appear in previous months; resolutions removed from the
   template are NOT removed from the months they were part of.
7. Single user, no login, private data.
8. Keep it simple: no pre-filled templates.

## 3. Decisions

| Topic | Decision |
|---|---|
| Stack | Vanilla HTML/CSS/JS, no build step, no framework. One `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`. |
| Language | Spanish UI only (domain terms are Spanish). Strings live inline; no i18n layer. |
| Storage | `localStorage` key `he.v1`, one JSON document (see §4). Data never leaves the phone. `navigator.storage.persist()` requested at boot. Backup = JSON export via share sheet. |
| Month snapshots | Each month gets its own frozen copy of the resolution list + examen text, created lazily **only for the current month** the first time it is opened. Past months never opened stay empty (read-only message). |
| Template edits | Apply to the template AND the current month's snapshot. Past months untouched. Removing a resolution that already has checks this month: removed from template only; it stays in the current month and disappears from next month on. |
| Checks | **Every frequency is checked on a specific day**: `checks[id][YYYY-MM-DD] = true`, stored globally (not per month). Weekly/monthly puntos are "up to date" when any day of the current ISO week / month is checked; Hoy shows "Esta semana: hecho el martes 1" or "pendiente". (v1 used period keys; `migrate()` drops them.) |
| Scores | Global `scores[YYYY-MM-DD] = 1..5`. Tap the selected score again to clear. No word labels under the chips (Alfredo found them awkward). |
| Day rollover | The logical day changes at **06:00**, not midnight (`today()` in app.js), because Alfredo fills the app at night. Hoy shows a "Madrugada" banner between 00:00 and 05:59 and always the full date ("Martes, 1 de septiembre"). Future days blocked relative to the logical day. |
| Naming | Tabs: Hoy · Mes · Configuración. Configuración screen title: "Puntos del horario espiritual"; UI says "punto", code says `resolution`. Data/backup and about live at the bottom of Configuración (no separate settings screen). |
| Editing the past | Allowed for checks and scores in any month (fixing forgotten days). Future days are disabled. The resolution LIST of a past month is frozen. |
| Month grid | ONE table: header rows = week spans ("1–6", "7–13"), weekday letters, day numbers; then the examen row and group rows (Diarios / Semanales / Mensuales) with one row per punto. Monday columns get a left border. Totals: daily `n/daysElapsed`, weekly `weeksDone/weeksElapsed` (a week counts if any day of the full ISO week is checked), monthly ✓ or –. The PDF will mirror this table. |
| PDF | jsPDF 2.5.1 loaded lazily from cdnjs only when exporting (core app has zero deps). A4 landscape, drawn with lines/text. Delivered via `navigator.share({files})` (works in iOS standalone PWAs, where `window.print()` does not); falls back to download. |
| Hosting | TBD with Alfredo: GitHub Pages under personal account `AlfredoSchoch` (public repo, no personal data in code) vs Cloudflare Pages (private repo). PWA install needs HTTPS, so real-phone testing needs hosting. |
| Icons | Generated with Pillow (`scripts/make_icons.py`): 180 (apple-touch-icon), 192, 512. |

## 4. Data model (`localStorage['he.v1']`)

```json
{
  "version": 1,
  "template": {
    "particular": "Vivir la paciencia en casa",
    "resolutions": [
      { "id": "r1abc", "text": "Misa", "freq": "daily", "order": 0, "createdAt": "2026-09-01" }
    ]
  },
  "months": {
    "2026-09": {
      "particular": "Vivir la paciencia en casa",
      "resolutions": [ { "id": "r1abc", "text": "Misa", "freq": "daily", "order": 0 } ]
    }
  },
  "checks": { "r1abc": { "2026-09-01": true, "2026-W36": true, "2026-09": true } },
  "scores": { "2026-09-01": 4 },
  "settings": {}
}
```

`freq` ∈ `daily | weekly | monthly`. Ids are stable across months so history per resolution
is possible later.

## 5. Screens

- **Hoy** — day navigator (‹ › + "Día pasado · volver a hoy"), late-night banner, examen particular
  card with 1–5 chips, then Diarios / Semanales / Mensuales checklists (all checked per day; weekly
  and monthly rows show when they were done this week/month). Future days blocked.
- **Mes** — month navigator; examen card with average; one grid (see Decisions); "Exportar PDF".
- **Configuración** ("Puntos del horario espiritual") — examen particular textarea; three sections
  with inline edit, ↑↓ reorder, × delete, add form each; note on month semantics; Datos card
  (export/import JSON backup); version line.

## 5b. Feedback log

- 2026-09-01 (after first slice): fill happens at night → 6am rollover + explicit date; weekly and
  monthly puntos must be checked on the actual day (he wants to see *when* in the month view);
  rename Resoluciones → tab "Configuración", screen "Puntos del horario espiritual"; drop the
  score words. All applied in v0.2.
- 2026-09-01: he has his current horario in a Google Sheet and wants it preloaded. Plan: read the
  sheet, build a backup JSON (template + current month), import it via Configuración → Importar.
  Do NOT commit personal puntos to the public repo.

## 6. Status

- [x] Step 1 — Scaffold, git init, docs (this file, CLAUDE.md, README).
- [x] Step 2 — Data layer + date utils + Hoy view (`app.js`).
- [x] Step 3 — Resoluciones editor with template/current-month semantics.
- [x] Step 4 — Mes view: grids, toggling, navigation.
      Verified 2026-09-01 in the in-app browser: date helpers unit-tested (ISO weeks incl. year
      boundaries and DST), and scripted checks of add/edit/reorder/remove semantics, month
      freezing, score toggle and cell toggling all passed.
- [ ] Step 5 — PDF export (jsPDF, share sheet, A4 landscape). Button currently shows a toast.
- [x] Step 6 — Backup export/import + Ajustes (basic version done; polish in step 7).
- [ ] Step 7 — PWA: `manifest.webmanifest`, icons, `sw.js` (cache-first shell, runtime cache
      for jsPDF, version bump strategy), iOS meta tags, install instructions screen.
- [ ] Step 8 — Hosting: GitHub Pages, public repo under Alfredo's PERSONAL account `aschoch`
      (gh currently logged in as work account `AlfredoSchoch`; he must run `gh auth login` for
      `aschoch` first). Then deploy + install on iPhone + smoke test.
- [ ] Step 9 — Preload his puntos from his Google Sheet (see feedback log) as an importable JSON.
- [ ] Optional — importer for the old app's backup JSON.

## 7. How to run / test locally

```bash
cd ~/Documents/horario-espiritual-pwa && python3 -m http.server 8765
```
Open http://localhost:8765 . Use the in-app browser (Claude Browser pane) or Safari with
responsive design mode (iPhone). localStorage is per-origin, so test data stays on
`localhost:8765`.

## 8. Resume notes for the next agent

- Keep everything in the three source files; no bundler. Event handling is delegated from
  `#view` via `data-action` attributes. Views are pure functions returning HTML strings.
- Any schema change: bump `version`, extend `migrate()` in `app.js`, keep old data loading.
- After finishing a step: update §6, `git commit`.
- Do not add templates, categories, streaks or charts. Simplicity is the point.
