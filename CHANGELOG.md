# CHANGELOG

All notable changes to this project are documented in this file.

## [0.2.1] - 2026-05-10

### Fixed
- Fixed a regression where canvas undo/redo could no-op when triggered by toolbar buttons or `Ctrl/Cmd+Z` shortcuts.
- Undo/redo now reads and applies workspace history snapshots deterministically before updating history state.

## [0.2.0] - 2026-05-10

### Added
- New `Save & Load` tab for workspace management.
- Explicit `Create New Workspace` action in both app toolbar and `Save & Load` tab.
- Workspace list with active indicator and one-click `Load`.
- `Save Version` action for manual restore points on the active workspace.
- IndexedDB active-workspace metadata store for tracking current workspace.

### Changed
- Persistence model upgraded from single active document to multi-workspace storage.
- Existing legacy `active-document` records are migrated into a real workspace during DB upgrade.
- `Versions` history is now scoped to the active workspace.
- Switching workspaces now autosaves the current workspace before loading the target workspace.
- Status footer now shows the active workspace name.
- Reset now clears only the active workspace canvas; other workspaces and version history are kept.
- Replaced native browser `prompt`/`confirm` with styled in-app dialogs for workspace create/reset actions.
- New workspace creation now prevents duplicate titles using case-insensitive auto suffixes (`(2)`, `(3)`, ...).
- Added workspace deletion from `Save & Load` with confirmation; deleting a workspace also removes its version history.
- Added canvas undo/redo per workspace (100 in-session steps) with topbar controls and keyboard shortcuts.

## [0.1.3] - 2026-05-10

### Added
- Arrow endpoint bindings now persist source/target connector references (`elementId` + handle) for live connection tracking.

### Changed
- Arrow rendering updated from straight segments to smooth curved connector paths.
- Connected arrows now auto-follow their bound shapes when those shapes are moved or resized.
- Existing saved arrows without connector binding metadata are auto-inferred and synchronized when possible.

## [0.1.2] - 2026-05-10

### Added
- Keyboard deletion support: `Delete` and `Backspace` now remove selected canvas element(s) when not typing in inputs.
- Arrow connector handles on rectangle/ellipse/sticky shapes for direct connection authoring.
- Marquee selection box for drag-selecting multiple elements in Select mode.
- Multi-selection move support (drag any selected element to move the whole selection).
- `Ctrl+A` / `Cmd+A` shortcut to select all elements on the canvas.

### Changed
- Arrow creation flow changed from click-start/click-end to drag-from-connector-to-connector.
- Layer list highlighting now reflects multi-selection state.
- Properties panel shows multi-selection guidance when more than one element is selected.

## [0.1.1] - 2026-05-10

### Added
- Direct on-canvas resize handles for selected `Rectangle` and `Ellipse` elements (corner drag).
- `W` and `H` size inputs in the Properties panel for `Rectangle` and `Ellipse`.

### Changed
- App shell now uses full-width layout (removed centered max-width container).
- Default document name changed to `Untitled`.
- Minimum size for rectangle/ellipse resizing is now enforced at `20x20`.

### Removed
- Demo/dummy seeded canvas elements from default startup state.
- Demo stencil entries from default stencil library.

### Persistence
- Added legacy demo snapshot detection so old seeded sample data is cleared on load.

## [0.1.0] - 2026-05-10

### Added
- React + Vite project setup (no CDN usage).
- Interactive wireframe editor UI with:
  - App layout tab
  - Stencil library tab
  - Export panel tab
- Canvas drafting tools:
  - Select/move
  - Pen (freehand)
  - Rectangle
  - Ellipse
  - Arrow
  - Text
  - Sticky note
- Properties panel for editing selected element details.
- Layer list for quick selection.
- Export support for PNG, SVG, and JSON.
- `start-server.bat` for one-click local startup.

### Changed
- Vite dev server port set to `7000` with `strictPort: true`.

### Persistence
- Added IndexedDB-based autosave for active document state.
- Added manual save snapshots (version history).
- Added restore from saved versions.
- Added workspace reset that clears IndexedDB state.
