# Project history

This file is append-only. Earlier product changes are recorded in CHANGELOG.md and Git.

## 2026-11-17 — Partition 2 migration

- Moved the complete checkout, Git history, dependencies, builds, and retained test
  artifacts from `/Users/leo/Documents/ChatGPT/pi-gui` to
  `/Volumes/PARTITION 2/codex/PI-GUI`. Compared all source file contents, permissions,
  hard links, and symbolic links before removing the original duplicate. The old path
  remains a symbolic link so existing chats, scripts, and artifact links keep working.
- Kept the current `codex/distribution` branch and GitHub remotes. Git's full object
  integrity check passed after copying; existing unreachable objects were preserved.
- Moved bulk app and shared Pi data into the ignored, private `.local-data/` folder:
  sessions, attachments, checkpoint objects, caches, installed Pi dependencies, and
  pi-gui update backups. Existing entry points use symbolic links to those locations.
- Kept `/Applications/pi-gui.app` installed locally. The app requires its profile and
  agent roots to retain their local identity, so those roots and small mutable settings,
  credentials, and OS-managed files remain in their existing locations. The installed
  app reopened successfully with its existing threads and transcripts after migration.
- Configured project pnpm store, cache, and state directories inside the checkout.
  Application source, installed application version, and user settings were unchanged.
- Confirmed the original checkout was outside OneDrive; no matching original pi-gui
  project folder was found under the connected OneDrive folders.

For development, use Node 22.19 or newer below 26 and the pinned pnpm 10.25.0.
Run `pnpm check` and `.agents/skills/verify-pi-gui/scripts/prove.sh --smoke` from the
new checkout. Set `TMPDIR` to a directory under `.cache/` when retaining test scratch
files on Partition 2. Native app installation can remain in `/Applications`.

### Migration validation and runtime notes

- Frozen-lockfile dependency installation, lint, architecture checks, all workspace
  typechecks, and the complete baseline test lane passed on Partition 2. Desktop
  unit coverage reported 934 passed and two skipped.
- The desktop build and both foreground open-folder tests passed. The settings
  transparency test also passed across an Electron restart. The user's installed
  app remained available with its original sessions; verification apps exited.
- `pnpm check` still reports formatting issues in four unchanged documents under
  `docs/agent-work/`. Those existing files were preserved; the remaining check
  stages were run separately instead of being blocked by formatting.
- The older `prove.sh --smoke` recipe removes the test mode required for profile
  sandbox overrides. It exited as a second instance of the installed app and was
  not counted as passing. The supported foreground and settings test lanes above
  supplied migration verification without changing production profile policy.
- The full baseline's formatting guard needs scratch files outside the checkout's
  ignored directories. Use `TMPDIR=/Volumes/PARTITION 2/codex/PI-GUI-TMP/` for that
  command; retained scratch files remain on Partition 2 alongside the checkout.
- A standalone official Node 24.22.1 runtime is retained under
  `.cache/toolchain/node-v24.22.1/`, with its archive checked against the official
  SHA-256 listing. Use its `bin` directory before system Node on `PATH` for builds;
  the chat application's bundled runtime restricts loading third-party native
  modules. Logs are retained in `.artifacts/partition2-migration/`.
