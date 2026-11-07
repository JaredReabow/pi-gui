# Agent access modes

The composer access selector and Settings → General → **Default agent autonomy** control model-visible tool execution.

| Mode         | Automatic actions                                                                               | Actions requiring a human decision                                                     |
| ------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Read only    | Scoped project reads                                                                            | Every edit, command, protected/external access and opaque tool                         |
| Project only | Scoped reads and ordinary project file edits                                                    | Commands, protected/external access and opaque tools                                   |
| Auto access  | Scoped reads; reviewer-approved low/medium-risk edits and commands within the automatic sandbox | Uncertain, malformed, unavailable, high-risk, unsupported or sandbox-denied operations |
| Full access  | Native tools within the current OS account's privileges                                         | No per-action tool approval; enabling the mode requires explicit confirmation          |

**Approval review model** is independently selectable per thread and defaults to **Same as chat**. Reviewer selection does not change the chat or Summary model. Human approvals apply to one finalized action, not future calls. Approval explicitly permits native execution outside the automatic sandbox. Policy changes are durably published before affected runs are cancelled; stale approvals cannot execute under the old revision.

## Persistence and migration

`autonomy.json` is protected application data, not project configuration. Schema v1 named the project-editing mode `read-only`; schema v2 preserves those saved privileges under `project-only`. Only v2 `read-only` means true read-only. Fresh profiles default to Read only. Reviewer selections, other modes and session overrides are preserved. Corruption or stale backup recovery fails closed rather than restoring older Full access.

## Enforcement and limits

The implementation follows Codex's separation of approval policy and sandbox scope, using released Pi tool overrides and hooks rather than prompt-only restrictions. Unknown, custom and nested tool calls are gated too. Installed trusted extensions and host automation remain outside this model-tool boundary; this is not account-wide isolation.

The automatic macOS sandbox confines writes to the project and isolated action scratch space, excludes protected configuration/credentials/app authority and prevents ancestor-relocation and hardlink escapes. File reads guard actual resolved paths and pinned file identities. Automatic commands cannot fork or leave detached descendants, so multi-process commands may need a one-time human escalation. Command reads resemble Codex workspace-write account read access, except protected credentials/authority. There is no silent unsandboxed retry.

Review requests are tool-free, bounded and cancellable with a 20-second deadline. Human dialogs expire after 120 seconds. Unsupported platforms ask for approval rather than automatically running unrestricted. A nested-only abort can leave an opaque-tool dialog visible until response/deadline because the released hook lacks that per-call signal; SDK core still prevents aborted execution. Whole-run Stop cancels the dialog.

## Verification and references

- Native policy, path, sandbox and SDK integration tests: `packages/pi-sdk-driver/test/autonomy-*.test.mts`.
- Persistence and revocation ordering: `apps/desktop/tests/unit/autonomy*.spec.ts`.
- Electron modes, approvals, migration and restart: `apps/desktop/tests/core/autonomy.spec.ts`.
- Explicit real-provider review: `apps/desktop/tests/live/autonomy.spec.ts`.

macOS runtime proof does not establish Windows/Linux behavior. Ad-hoc local packages are not a notarized public release.

Research: [Codex approvals/security](https://developers.openai.com/codex/agent-approvals-security/), [configuration reference](https://developers.openai.com/codex/config-reference/), and upstream [Seatbelt implementation](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/seatbelt.rs).
