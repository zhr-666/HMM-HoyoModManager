# Workshop navigation and dependency checks

Goal: implement the user's eleven requested changes and publish the verified Windows build.

Constraints: preserve mod data; passive installation only; GitHub prerequisites open in browser; publish is explicitly authorized. Filesystem dependency scans are limited to Mods/HoYoModManaged/BufferValues and Other/Misc recursively. ORFix must not satisfy ORFixapi.

- [x] Dependency checks: replace full-tree provider scans with bounded filename inventory and identity metadata; add boundary, disabled path and scope regression tests.
- [x] Dialog navigation: retain parent detail DOM, selected file and scroll position; retain reminder when visiting prerequisites; provide back navigation, handle cancel/continue and asynchronous reminders without locking operations.
- [x] Workshop: animated skeleton loading, image-first details, single-line detail button.
- [x] Library/navigation: compact icon sidebar, managed-folder opener, item context menu, hotkey overview.
- [x] Verify: unit tests, real Electron navigation/concurrency, themes, updater preparation using real ZIP and packaged updater. Review changes.
- Release procedure: bump version, build Windows ZIP, verify SHA256/source, commit/push and publish GitHub release.

Implementation uses the existing Electron IPC and theme. Preserve underlying dialog nodes rather than serializing HTML, so input selections and event handlers survive back navigation. Dependency navigation cancels the pending operation to release its lock while retaining its visual reminder; returning to act on it must re-run the original action and fresh dependency check.
