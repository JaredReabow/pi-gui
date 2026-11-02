# Changelog

## Unreleased

### Conversation

- Added persistent conversation goals, in-thread model switching with a context-change
  confirmation, prompt-history recall, copy controls, full Markdown transcript copy, and
  day/hour/minute/second duration formatting.
- Scheduled messages now wait for the target thread's existing queued message to drain
  instead of stacking additional follow-ups. Due tasks remain pending and can fire once the
  queue becomes empty.
- Kept pre-compaction messages and tool calls visible, pinned the prompt responsible for
  the response currently in view, and compacted completed tool rows without hiding failures.
- Added the selectable running indicator styles, with the moonwalk pair as the default.

### Sidebar and navigation

- Added persistent per-project colours, muted inactive projects, separate rounded inactive
  thread rows, and perimeter colour only for the active project.
- Restored the project-coloured window perimeter and active-project seam bridge in maintained
  source, aligned the pane corners with the native window curve, and kept the full title strip
  draggable.
- Restored the six selectable running indicators in Settings, including the animated moonwalk,
  sine wave, bouncing ball, stick figure, wheel, and spiral, with durable persistence.
- Added open, partial, and closed folder states, unread and selected-thread reveal, compact
  child rows with inline age, separated child groups, and parent/child history controls.
- Added All Threads sorting by activity, latest human input, unread state, creation time,
  and title. Activity sorting now uses the real session activity timestamp while preserving
  the established Today/Last 7 Days/Last 30 Days/Older grouping.
- Added confirmation-backed Mark all read, subagent status/model/duration/history metadata,
  and persistent project colour selection from the project menu.

### Configuration and integrations

- Restored the model-aware orchestration harness: the agent now sees `spawn_worker`,
  `list_models`, and the pi-gui thread tool names, can discover exact available
  provider/model pairs and thinking support, and can run an inline worker on the inherited
  or explicitly selected model without creating a thread.
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
