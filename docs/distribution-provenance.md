# Distribution provenance and release obligations

## Source provenance

This distribution is derived from the original `pi-gui` project at
`https://github.com/minghinmatthewlam/pi-gui`. The accepted distribution
baseline is commit `faf8edd6d7a7e3bf3c508d6f600a22d3821ac108`.

The original Git history, copyright headers, contributor record, and source
attribution are retained. The root MIT license names Matthew Lam and applies
to the upstream source and substantial portions of this distribution. A
separate distribution copyright and publisher line are not yet selected.

The product is built on the MIT-licensed Pi runtime and
`@earendil-works/pi-coding-agent` ecosystem. It also bundles Electron and
other npm/native dependencies under their own terms.

## Publication boundary

No product name, application ID, publisher, repository, website/domain,
support contact, update feed, signing identity, or release channel has been
approved by this task. The checked-in build identity is candidate-only:

- display identity: `pi-gui Candidate`
- application ID: `com.pi-gui.desktop.candidate`
- package and executable identity: `pi-gui-candidate`
- candidate data root: the platform app-data directory plus
  `pi-gui-candidate`
- candidate Pi data root: `<candidate user data>/agent`

The candidate name is stable across commits. It deliberately excludes Git
branches, commit hashes, and package versions so local locks, sessions, and
settings do not multiply for every change.

Candidate startup never imports the installed upstream app's Electron profile,
the global Pi profile at `~/.pi/agent`, or an ambient upstream release feed.
`PI_CODING_AGENT_DIR` or `PI_APP_USER_DATA_DIR` may point to an isolated test
directory. A future personal-data import must be an explicit user choice and
must preserve the source state.

Optional schema-2 usage and crash telemetry is owned by the main process and
stored under `<candidate user data>/telemetry/state.json`. The technical
telemetry app ID is the stable `pi-gui`, independently of the unresolved final
product/package identity. Both consent choices initially default off. Tests
replace the production transport with an inert failure transport, so a test
cannot contact the production collector even if it changes consent. Consent
controls and disclosure copy remain D12 work; no production receipt,
retention, deletion, or reporting acceptance is claimed by this integration.

## Shared release contract

`@pi-gui/distribution-config` is the browser-safe source for distribution
profiles, release manifests, release gates, and the accepted support policy.
Its Node-only export resolves stable data paths before Electron chooses its
profile.

A published release manifest contains:

- schema and channel;
- product, version, platform, architecture, and minimum OS;
- an HTTPS artifact URL containing the immutable version path segment;
- positive byte size and lowercase SHA-256;
- an HTTPS release-note URL;
- repository and website identity;
- explicit rollback metadata for the previous release, or an explicit
  first-release record.

Candidate manifests contain no artifact, release-note URL, repository, domain,
or usable update destination. Candidate profiles and candidate manifests are
rejected by both update and publication gates. A published profile can enable
update checks only after all identity, repository, domain, and manifest fields
are supplied. Publication additionally requires a fresh owner authorization.

The website and updater are intended to consume this same representation.
The existing website/menu/solicitation UI remains deferred to D12/D14.

## Support policy

`@pi-gui/distribution-support` is the single source for voluntary-support
options, exact destination allowlists, and local dismissal behavior.
`@pi-gui/distribution-config` exposes that policy without duplicating its
destinations. Automatic post-use solicitation remains disabled. Checkout does
not establish payment or entitlement.

## Third-party release obligations

Before any publication, the release owner must review the accepted
[license and redistribution inventory](../artifacts/distribution/D03/licenses-redistribution.md)
and package evidence. At minimum:

1. Preserve `LICENSE` and credit Matthew Lam and the original project.
2. Include notices for Pi, Electron/Chromium/Node, native modules such as
   `node-pty` and `photon-node`, and every packaged npm dependency.
3. Build the notice bundle from the actual packaged bytes and exact
   architecture, not only the development lockfile.
4. Resolve or exclude unreviewed copyleft payloads, including the installed
   `doom.wasm` demo blocker identified in D03.
5. Scan for credentials, personal paths, source maps, test fixtures, and
   developer-home references.
6. Attach the final publisher identity, signing owner, support contact, source
   offer/link requirements, and rollback/checksum evidence to the release
   record.

This document is an engineering inventory boundary, not legal advice.
