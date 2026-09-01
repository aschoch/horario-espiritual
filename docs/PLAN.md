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
| Checks | Stored globally by `(resolutionId, periodKey)`, not per month, so a week that spans two months shows the same state in both. Period keys: daily `YYYY-MM-DD`, weekly ISO `YYYY-Www` (Monday start), monthly `YYYY-MM`. |
| Scores | Global `scores[YYYY-MM-DD] = 1..5`. Tap the selected score again to clear. |
| Editing the past | Allowed for checks and scores in any month (fixing forgotten days). Future days are disabled. The resolution LIST of a past month is frozen. |
| Weeks in month view | All ISO weeks intersecting the month, labelled by their day range inside the month (e.g. "1–7", "29–30"). |
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

- **Hoy** — day navigator (‹ › + "Volver a hoy"), examen particular card with 1–5 chips,
  then Diarias / Semanales (week label) / Mensuales checklists. Future days blocked.
- **Mes** — month navigator; examen card with average; daily grid (rows = resolutions,
  columns = days, weekday letters, weekend shading, today outline, totals `n/N`); weekly grid
  (columns = weeks); monthly checklist; "Exportar PDF".
- **Resoluciones** — examen particular textarea; three sections with inline edit, ↑↓ reorder,
  × delete, add form each; explanatory note on month semantics.
- **Ajustes** (gear) — storage info, export/import JSON backup, about.

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
- [ ] Step 8 — Hosting decision + deploy + install on Alfredo's iPhone + smoke test.
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
