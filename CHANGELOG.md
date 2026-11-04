# Changelog

## Unreleased

### Conversation

- Saved user messages and assistant replies now expose inline Edit and Delete actions.
  Edits preserve prompt attachments and provenance in model context, deletion requires a
  second confirmation, and both actions stay disabled while a run or queue is active.
  Changes are recorded as branch-local append-only history markers, so the transcript
  updates immediately and survives restart without corrupting Pi's session tree.
- User messages in the transcript now show a locale-aware sent date and time beside the
  message bubble. Queued messages use their actual send-event time rather than the earlier
  queue-creation time.
- The assistant reply copy control now reads “Copy” while retaining the accessible name
  “Copy response.”
- Added persistent conversation goals, in-thread model switching with a context-change
  confirmation, prompt-history recall, copy controls, full Markdown transcript copy, and
  day/hour/minute/second duration formatting.
- Scheduled messages now wait for the target thread's existing queued message to drain
  instead of stacking additional follow-ups. Due tasks remain pending and can fire once the
  queue becomes empty.
- Kept pre-compaction messages and tool calls visible, pinned the prompt responsible for
  the response currently in view, and compacted completed tool rows without hiding failures.
- Collapsed adjacent successfully completed tool calls into one summary row that reports the
  action count and tool mix, with controls to restore the original rows. Running tools,
  failures and image results remain visible while collapsed.
- Kept the pinned turn-prompt rail mounted across timeline gaps and compacted tool groups, so
  it no longer flickers when the transcript is following the newest messages.
- Added the selectable running indicator styles, with the moonwalk pair as the default.

### Sidebar and navigation

- Added persistent per-project colours, muted inactive projects, separate rounded inactive
  thread rows, and perimeter colour only for the active project.
- Added thread context-menu branching. A thread can be copied at its current conversation
  head into the same project or into another project chosen from the live workspace list.
  The original thread remains unchanged and the new branch opens empty for continued work.
- Restored the project-coloured window perimeter and active-project seam bridge in maintained
  source, aligned the pane corners with the native window curve, and kept the full title strip
  draggable.
- Restored the six selectable running indicators in Settings, including the animated moonwalk,
  sine wave, bouncing ball, stick figure, wheel, and spiral, with durable persistence.
- Added open, partial, and closed folder states, unread and selected-thread reveal, compact
  child rows with inline age, separated child groups, and parent/child history controls.
- Backfilled thread creation ages from Pi's session-header timestamps, including imported and
  agent-created threads, instead of showing `Unknown` when the UI-created-session map had no
  entry. Runtime catalog writes preserve the source timestamp.
- Replaced the active project's generic overflow link with a project-coloured, counted
  “N Threads hidden” disclosure. Expanding it now reliably reveals “Show less,” while
  inactive projects retain the quieter “Show more” control.
- Added All Threads sorting by activity, latest human input, unread state, creation time,
  and title. Activity sorting now uses the real session activity timestamp while preserving
  the established Today/Last 7 Days/Last 30 Days/Older grouping.
- Added confirmation-backed Mark all read, subagent status/model/duration/history metadata,
  and persistent project colour selection from the project menu.

### Configuration and integrations

- pi-gui now reads `~/.pi/agent/models.json` as Codex Router's shared, read-only model
  catalog while retaining its isolated auth, settings, sessions, and custom endpoint store.
  Router publications are picked up on app focus, so newly published models appear without
  restarting or manually copying catalog entries.
- Fixed `create_child_thread` and `spawn_worker` model normalization when the host supplies
  the legacy `selection` field beside the documented top-level `model` and `thinkingLevel`.
  The top-level model remains authoritative, while `thinkingLevel` can combine with the
  provider/model identity in `selection`.
- Added a first-launch project importer for Cursor, Claude and ChatGPT. It discovers local
  project workspace metadata, expands multi-root Cursor workspaces, reviews every candidate
  locally, imports only selected folders, and recommends a connected model for intervention.
  Deterministic imports contact no model; only a failed import receives a bounded, sanitized
  summary, and the model may choose continue, skip, or one retry.
- Restored the model-aware orchestration harness: the agent now sees `spawn_worker`,
  `list_models`, and the pi-gui thread tool names, can discover exact available
  provider/model pairs and thinking support, and can pass those values through the visible
  top-level `model` and `thinkingLevel` arguments to run an inline worker without creating a
  thread.
- Added direct scheduled-task Pause/Resume controls with persisted state and pending/error
  feedback.
- Added subagent limits, searchable and bulk-selectable effective model allowlists, and
  remembered unavailable choices.
- Added the local MCP configuration and runtime bridge, setup/checkpoint contracts, platform
  permission contracts, lifecycle recovery foundations, and a bounded background test
  harness.
- Added schema-2 telemetry with independent usage and crash consent, durable provenance,
  bounded queues, cancellation-safe delivery, and test-only transport isolation.
- Added the donation/support surface using the existing monthly Stripe and one-off
  Stripe/PayPal links.
- Changed the moonwalk activity indicator to one stick figure, vertically aligned the
  sine-wave indicator with the thread title, and made the wave repeat through a full
  off-screen cycle so it loops without a phase jump.

### Packaging

- Added a separately identified macOS development candidate so it can be installed beside
  the existing application without sharing or replacing its profile.
- Added packaged startup, thread creation, integrated terminal, installation, and signature
  verification. Notarization remains a release gate because notarization credentials were
  not available to this build.
- Added backward-compatible import for the installed 1.0.14 UI state, including legacy
  activity timestamps, child origins, orchestration model metadata, and runtime preference
  fields, so upgrading retains the existing project and thread list.
- Preserved the validated legacy fields and child parentage across later autosaves, and
  retained one immutable pre-migration snapshot even though the repair build already used
  UI-state version 20.
