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
- App supports multiple workspaces (not just one draft).
- `Create New Workspace` creates and switches to a new named workspace from the current draft.
- `Save & Load` tab lists workspaces and lets users switch between them.
- Switching workspace autosaves the current workspace before loading the selected one.
- Manual `Save Version` creates restore points for the active workspace.
- `Versions` restores snapshots only from the active workspace.
- Export supports `PNG`, `SVG`, and `JSON`.
- New documents start with no seeded demo elements.
- Legacy seeded demo snapshots are detected and cleared during load.
- `Rectangle` and `Ellipse` can be resized directly on the canvas via corner drag handles (Select tool), or by `W`/`H` fields in Properties.
- Rectangle/ellipse minimum size is `20x20`.
- Main app shell uses full-width layout.
- `Delete` / `Backspace` removes currently selected element(s) when focus is not inside form inputs.
- Arrow tool uses connector drag workflow: drag from connector dot on one shape to another connector dot.
- Connected arrows render as smooth curved paths (cubic Bezier), not straight lines.
- Connected arrows stay attached to source/target connector handles when shapes are moved or resized.
- Select tool supports marquee (drag-box) multi-selection.
- Multi-selected elements can be moved together by dragging any selected element.
- `Ctrl+A` / `Cmd+A` selects all elements on the canvas.
- Reset clears only the active workspace canvas (keeps other saved workspaces and version history).
- Create/reset actions use styled in-app dialogs (no raw browser `prompt`/`confirm`).
- New workspace names are deduplicated case-insensitively using auto suffixes (`Name`, `Name (2)`, `Name (3)`, ...).
- Workspaces can be deleted from `Save & Load`; deleting also removes that workspace's saved versions.
- Canvas editing supports per-workspace in-session undo/redo (100 steps) via buttons and `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`.
- Undo/redo snapshot application is deterministic for both toolbar clicks and keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`).

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
- If changing workspace persistence behavior, keep legacy single-document migration logic intact for backward compatibility.
- If changing startup/default document behavior, keep legacy demo-data cleanup logic in `src/App.jsx` aligned with persisted document shape.
