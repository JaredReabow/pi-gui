# Sidebar expansion preferences

The sidebar remembers independent parent/child-thread folds, **Show more / Show less** choices and archived-section visibility in the application's browser profile. Existing main-process workspace-folder preferences remain authoritative.

The renderer-only owner is `src/features/threads/use-sidebar-expansion.ts` in the desktop application. It validates `pi-gui.sidebar-expansion.v1`, saves actual changes synchronously and tolerates unavailable browser storage. Saved keys are not pruned while catalogs or parent links hydrate. It does not modify session history, archive status, selection or agent permissions, and requires no new preload/Node API.

Startup and Sidebar remount restore folds, including ancestors of the currently selected child. Actual selection changes while mounted and explicit rename still reveal the relevant path; manual folds win over later metadata refreshes. Explicit folder closure clears an older Show more override.

Previously discarded in-memory fold choices cannot be reconstructed. Choices made with this implementation persist across subsequent normal restarts, provided the application's browser storage is retained.

## Verification

- Storage round trip, malformed/future data, unavailable storage: `apps/desktop/tests/unit/sidebar-expansion.spec.ts`.
- Mixed folders/nested folds, Settings remount, three launches, inverse choices and repeated rename: `apps/desktop/tests/core/sidebar-expansion-persistence.spec.ts`.
- Related regressions: `sidebar-folder-collapse.spec.ts`, `sidebar-recency.spec.ts`, `thread-hierarchy-archive.spec.ts`, thread-tree and shortcut unit tests.

The restart spec supports the shared packaged-app launcher when a packaged release directory is explicitly supplied. Seeded historical sessions are fixture setup, not real-provider conversation proof.
