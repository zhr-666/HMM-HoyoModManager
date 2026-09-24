# Genshin Hotkey Overlay Implementation Plan

**Goal:** Show a movable in-game hotkey entry and popup when the Genshin character page displays a character with enabled mods.

**Architecture:** A Windows-only monitor captures a small region of the desktop at intervals and sends it to an offline Tesseract worker. Pure matching and stability logic selects enabled mods. An Electron window controller owns the entry and popup, and a small game-scoped JSON file persists size, font, and position.

**Tech Stack:** Electron 44, Node 24, Tesseract.js 7, bundled `chi_sim` traineddata, Node tests.

**Spec:** `docs/superpowers/specs/2026-09-23-genshin-hotkey-overlay.md`

## Global Constraints

- Windows x64, Genshin 1920×1080 only for this iteration.
- Keep all unrelated uncommitted changes. Do not change `package.json` version or publish.
- Only enabled library mods supply hotkeys; do not execute mod code or modify GIMI.
- Every new UI file is included in `UI_ASSETS` and served without caching.

## Review Focus

- OCR inserts spaces or background glyphs: match the complete role name after the element slash, never a substring of another role.
- A stale screenshot or missing game process: hide both windows after the miss threshold and stop capture when unavailable.
- Role changes while popup is open: update or close the popup with the stable selected role.
- Overlay focus and drag: clicking the entry opens the popup, dragging persists position without accidentally opening it.
- OCR initialization or screenshot failure: surface one error, hide windows, and allow a later retry.

## Tasks

### Task 1: Pure recognition and state

**Files:** `src/core/game-hotkey-match.cjs`, `tests/game-hotkey-match.test.cjs`.

- [x] Write tests for OCR normalization, exact Chinese role matching across enabled mods, hotkey selection, 1080p crop scaling, and two-frame stability.
- [x] Run the tests and confirm expected missing-function failures.
- [x] Implement the pure functions and rerun the focused tests.

### Task 2: Offline OCR and capture

**Files:** `package.json`, `pnpm-lock.yaml`, `src/core/ocr-data/*`, `src/core/game-hotkey-monitor.cjs`, `THIRD-PARTY-NOTICES.md`, `scripts/verify-windows-package.cjs`.

- [x] Add focused monitor tests with injected capture and OCR functions, covering no game, successful match, capture error, and restart.
- [x] Confirm tests fail, then implement serialized polling and shutdown.
- [x] Add Tesseract.js and the local Chinese model. Verify the user screenshot manually without committing the screenshot or its UID.
- [x] Ensure the packaged source contains the model and required worker assets.

### Task 3: Overlay windows and settings

**Files:** `src/core/game-hotkey-overlay.cjs`, `src/ui/hotkey-overlay.html`, `src/ui/hotkey-overlay.css`, `src/ui/hotkey-overlay.js`, `src/core/ui-assets.cjs`, `tests/game-hotkey-overlay.test.cjs`, `tests/ui-assets.test.cjs`.

- [x] Add tests for persisted setting validation, screen clamping, and overlay visibility transitions; watch them fail.
- [x] Implement separate entry and popup windows, restricted IPC, drag persistence, and size/font controls.
- [x] Run focused tests and the UI asset cache test.

### Task 4: Main process lifecycle and verification

**Files:** `src/main.cjs`, `src/preload.cjs`, `docs/acceptance.md`, relevant tests.

- [x] Connect monitor to the active Genshin workspace and enabled-mod snapshot; only start on Windows and stop on quit/update.
- [x] Verify screenshot and hotkeys never leave the local machine and that errors do not terminate the app.
- [x] Run `pnpm check`, `git diff --check`, review the task diff, and record Windows tests that remain pending.

## Pending device validation

- [ ] On Windows x64 at 1920×1080, test live Genshin capture, window mode and exclusive fullscreen, dragging/clicking the entry, changing characters, resizing fonts, and closing the game and HMM.
