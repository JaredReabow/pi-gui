# Distribution support policy

This internal package is the shared source of truth for support options and
support-prompt dismissal policy. It performs no network request, payment,
verification, entitlement check, or URL opening.

## Public API

- `SUPPORT_OPTIONS` and `SUPPORT_OPTION_IDS` expose typed IDs and display
  metadata. Destination URLs are intentionally absent.
- `supportGetOption(optionId)` returns metadata for a validated ID.
- `supportResolveOptionUrl(optionId)` is the main-process resolver. It accepts
  only a known option ID and returns the corresponding fixed HTTPS URL.
- `SUPPORT_DISMISSAL_LABELS`, `INITIAL_SUPPORT_PROMPT_STATE`,
  `supportDismissPrompt(state, choice)`, and
  `supportStartPromptSession(state)` model local prompt state.
- `SUPPORT_AUTOMATIC_POST_USE_SOLICITATION` is disabled pending an approved,
  tested solicitation frequency.

The renderer should send only an option ID through its narrow host API. Main
processes should call `supportResolveOptionUrl` after validating that ID.
Neither dismissal choice verifies payment or grants an entitlement. "Not now"
dismisses the current prompt; "Don't ask again" persists local suppression.

## Source attribution

The labels, cadence, offer IDs, and PayPal recipient were adapted from the
Chrome Control MCP extension support policy (`extension/support.js`), supplied
as the migration reference. Unlike that source's provider-wide host matching,
this package allows only the exact URLs bound to the five typed IDs and rejects
URL-shaped renderer input.
