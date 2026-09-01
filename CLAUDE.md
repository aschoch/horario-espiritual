# Horario Espiritual (PWA)

Personal, single-user, offline-first web app to track a Schoenstatt "Horario Espiritual":
daily/weekly/monthly resolutions (checkboxes), one "examen particular" scored 1–5 per day,
month view exportable as PDF. Spanish UI. No backend, no login: data lives in localStorage.

- Full spec, decisions, data model and step checklist: `docs/PLAN.md` (read it first).
- Source: `index.html`, `styles.css`, `app.js` (+ `sw.js`, `manifest.webmanifest` once step 7 lands).
- No build step. Run: `python3 -m http.server 8765` in this folder.
- Predecessor (SwiftUI, too complex, being replaced): `~/Documents/horario-espiritual/`.
- Style: vanilla JS, `'use strict'`, pure render functions returning HTML strings, delegated
  events via `data-action`. Escape all user text with `esc()`.
- Keep it simple. No templates, categories, streaks, charts, or i18n.
