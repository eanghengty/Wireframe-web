# CHANGELOG

All notable changes to this project are documented in this file.

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
