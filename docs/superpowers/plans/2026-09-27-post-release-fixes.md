# Post-release Fixes Implementation Plan

**Goal:** Complete the eleven requested fixes and tools while protecting existing user data.

**Architecture:** Keep the current Electron main/preload/UI boundaries. Put file safety rules in core modules, keep dialog navigation in `dialog-stack.js` and `app.js`, and pass task state through the existing reporter channel.

**Spec:** `docs/superpowers/specs/2026-09-27-post-release-fixes.md`

## Global constraints

- No package version change, release artifact, upload, or publish.
- Preserve data, GIMI, manual mods, and legacy ShaderFixes files.
- UI assets remain in the whitelist; `hoyo://` UI responses use `no-store`; clear Chromium session cache on startup.
- Test code paths with temporary data, then run `pnpm check` and `tests/ui-assets.test.cjs`.

## Tasks

1. **Dialog and notification reliability:** Reproduce the stuck notification and close controls with focused UI tests. Fix top-layer moves and close handling in `src/ui/dialog-stack.js`, `app.js`, and CSS. Test stacked dialogs, popover open/close, busy actions, and Escape/back.
2. **Update dialog:** Add immediate update window, start button, live progress, result list, and all ignored versions in `app.js`. Reuse `checkUpdates`, `updateSummary`, and task events in `main.cjs`; prevent duplicate checks and stale-game results. Test cancel/failure and notification routing.
3. **Navigation and workshop:** Make import picker back step through categories, then exit at root. Audit other dialog back callbacks. Remove per-file direct download button and open installed GameBanana sources through the existing detail modal. Add targeted UI tests.
4. **ShaderFixes ownership:** Test cleanup of unchanged, changed, missing, skipped, legacy, and interrupted files. Record hashes for new writes in `src/core/shader-fixes.cjs`; implement safe cleanup and history removal via `library.cjs` and main IPC. Show results in an independent ShaderFixes modal.
5. **INI text replacement:** Test literal, case-sensitive text and chosen-mod scope, including empty replacement, stale preview, rollback, and enabled copies. Adapt `src/core/hash-replace.cjs`, library and IPC interfaces, then the independent UI modal. Preserve batch compatibility for existing history.
6. **Clipboard and logging:** Reproduce clipboard conversion failure in a focused test. Fix image conversion and add error capture/rotation for main, renderer and background work. Provide a settings action to open `data/logs`. Ensure logs omit sensitive contents.
7. **Verification:** Run focused tests after each component, then `pnpm check`, UI asset test, relevant smoke scripts, `git diff --check`, and inspect staged differences. Record unavailable macOS/Windows GUI checks honestly. Commit only task files.

## Review focus

- A dialog under an open notification popover: close and notification controls remain clickable.
- Update check finishes after its modal closes or active game changes: no stale content appears.
- ShaderFixes path is replaced by a link or contents change between install and cleanup: do not delete it.
- INI preview input, selected mods, or files change before apply: reject without altering library or enabled copies.
- Clipboard image is missing, huge, or invalid: report an error and leave saved previews intact.
