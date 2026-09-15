# GitHub Portable App Update Implementation Plan

> Execute inline in this session. User asked Codex to choose details; keep existing GitHub upload authorization boundary.

**Goal:** Update Windows portable HoYoMod from its own GitHub Releases without modifying mod data or configuration.
**Architecture:** An app update service checks stable release semver, downloads and verifies ZIP SHA256, then prepares an immutable replacement plan. A bundled PowerShell helper waits for this process to exit, replaces only application-owned top-level entries with backups and durable progress records, rolls back on failure, and restarts the app. Configuration and Mods paths are excluded; no directory-wide mirror/delete.
**Tech Stack:** Electron, existing HTTPS transport/7zip extraction, Node filesystem, Windows PowerShell.

## Constraints

- Repository fixed to zhr-666/HoYoMod; stable releases only, no downgrade.
- Prefer GitHub asset digest; reject missing/invalid SHA256 and unexpected release URL, name, or size.
- Preserve data, unknown sibling files, GIMI Mods, configured external EXE, and update working directory.
- Check automatically with notification only, manual check in settings. Download and restart are separate explicit UI actions.
- Block restart while mod downloads/installs or mutations run. Lock mutations during update handoff.
- No GitHub uploads until user says 上传.

## Task 1: Release and package validation

Create src/core/app-update.cjs and tests/app-update.test.cjs.
- Test release selection (newer/same/older, prerelease, wrong repository/digest/assets).
- Implement parseVersion, selectRelease(current,release), validatePackage(staging), replacementPlan(appDir,staging,protectedPaths).
- Validate required executable/resources; allow only HoYoMod.exe, runtime DLL/PAK/DAT/BIN files, known license/docs, resources and locales. Reject data and links.
- Test preservation using real temp program and data trees; reject overlap of a replaced directory with configured Mods/data paths.

## Task 2: Download, staging, and Windows helper

Create src/core/app-update.ps1; extend update service.
- check() -> current/available; prepare() -> verified staging and progress; handoff() -> helper spawn only on packaged Windows.
- SHA256 must match before extraction. Persist update helper, plan, and backup under .hoyo-updates.
- PowerShell reads JSON with literal paths (no interpolated command text), waits exact original process, journals each rename before proceeding, retries locked file operations, restores prior entries on failure, restarts only after success/rollback.
- Startup detects interrupted pending transaction and offers recovery; helper logs retained. Copy only targeted entries; data excluded by both JS and helper.
- Add tests for partial download, bad digest/package, duplicate preparation, and source/data preservation.

## Task 3: UI and lifecycle integration

Modify src/main.cjs, src/ui/index.html, src/ui/app.js, src/ui/style.css.
- Settings Software Update card shows current version, latest status, release notes, check/download/restart controls.
- App update progress independent of mod queue. Quiet startup check after initialization, no startup modal for network errors.
- Handoff checks no queued/running mod work, awaits library and queue writes, starts helper then quits. On helper startup failure keep original app open.
- Add isolated renderer/IPC smoke for statuses, user actions and disabled restart during work. Never test actual external EXE execution on macOS.

## Task 4: Verification and artifact

Update documentation, bump local version to 0.9.0, package verification includes updater sources.
Run node tests, relevant Electron smoke tests, Windows ZIP build, packaged-source/RAR verification, unzip integrity, SHA256 output. Windows file-lock/restart behavior requires Windows acceptance and must be reported honestly.
