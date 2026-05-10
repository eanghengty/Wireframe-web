# AGENT.md

## Project
QE Wireframe Tool built with React + Vite (no CDN), with local persistence via IndexedDB and a blank-by-default canvas.

## Stack
- React 18
- Vite 5
- Lucide React icons
- Browser IndexedDB API

## Local Run
1. `npm install`
2. `npm run dev`
3. Open `http://localhost:7000`

## Quick Start (Windows)
- Double-click `start-server.bat`

## Build
- `npm run build`

## Important Behavior
- App state auto-saves to IndexedDB.
- Manual `Save` creates restore points (versions).
- `Versions` lets users restore previous saved snapshots.
- Export supports `PNG`, `SVG`, and `JSON`.
- New documents start with no seeded demo elements.
- Legacy seeded demo snapshots are detected and cleared during load.
- `Rectangle` and `Ellipse` can be resized directly on the canvas via corner drag handles (Select tool), or by `W`/`H` fields in Properties.
- Rectangle/ellipse minimum size is `20x20`.
- Main app shell uses full-width layout.

## Key Files
- `src/App.jsx`: main UI and canvas interactions
- `src/db.js`: IndexedDB persistence layer
- `src/App.css`: styling/layout
- `vite.config.js`: dev server config (port 7000)
- `start-server.bat`: local auto-start launcher

## Notes For Future Changes
- Keep CDN-free architecture.
- Preserve IndexedDB compatibility when modifying schema.
- If schema changes, increment DB version in `src/db.js` and handle migrations in `onupgradeneeded`.
- If changing startup/default document behavior, keep legacy demo-data cleanup logic in `src/App.jsx` aligned with persisted document shape.
