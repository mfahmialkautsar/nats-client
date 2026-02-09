# Change Log

All notable changes to the "nats-client" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

This project is licensed under the MIT License.

## [0.0.5] - 2026-02-08

### Added

- Support for advanced NATS authentication methods via meta headers:
  - User/Password: `NATS-User`, `NATS-Pass` — can also be provided in the URL (e.g. `nats://user:pass@host:4222`) — https://docs.nats.io/using-nats/developer/connecting/userpass#connecting-with-a-user-password-in-the-url
  - Token: `NATS-Token` — can also be provided in the URL (e.g. `nats://token@host:4222`) — https://docs.nats.io/using-nats/developer/connecting/token#connecting-with-a-token-in-the-url
  - Credentials File: `NATS-Creds` (supports file path) — https://docs.nats.io/using-nats/developer/connecting/creds
  - NKey: `NATS-Nkey` (supports file path or seed string) — https://docs.nats.io/using-nats/developer/connecting/nkey
  - JWT: `NATS-Jwt` (supports file path or raw JWT) — https://docs.nats.io/using-nats/developer/connecting/creds
  - TLS: `NATS-Tls-Ca`, `NATS-Tls-Cert`, `NATS-Tls-Key` (supports file paths) — https://docs.nats.io/using-nats/developer/connecting/tls#connecting-with-tls-and-verify-client-identity

## [0.0.4] - 2025-12-28

### Added

- JetStream publish and consume workflows, including a new JetStream Explorer view with create/update/delete and info actions for streams and consumers.
- Variable resolution tooling: Explorer-backed variable store, completion provider, and hover provider for `{{token}}` and `{{env:NAME}}` substitutions.
- Expanded automated coverage: reorganized tests into unit/e2e/integration suites, added JetStream e2e coverage, and refreshed CI/scripts.

### Changed

- Connection management now supports saved and ad-hoc connections persisted via VS Code Memento, with add/edit/delete/manage UI.
- Output/log handling is more consistent via centralized error handling and reveal logic across commands.

### Improved

- `.nats` parsing and syntax highlighting for variables, headers, and invalid command detection.
- Session resiliency and header handling, including clearer log metadata.

## [0.0.3] - 2025-11-20

### Added

- Manage NATS connections, subscriptions, and reply handlers directly from the Command Palette and the connection UI: list active items, stop or reconnect them, and quickly reveal output channels.
- Progress indicators for publish and request operations so you can see live status for long-running actions.
- Commands to check connection health and flush in-flight messages from the Command Palette.
- Now available on the Open VSX Registry.

### Improved

- Increased session stability: transient network interruptions are handled more smoothly and subscriptions are preserved where possible, reducing message loss and reconnect interruptions.
- Formatting and parsing improvements for `.nats` documents: formatting now preserves delimiter text and the parser recognizes delimiter lines with trailing text for more predictable edits.

### Changed

- Minimum supported VS Code version updated to 1.93.0 and Node.js version to 20.0.0.

## [0.0.2] - 2025-11-19

### Features

- View active NATS subscriptions and reply handlers from the Command Palette; take actions directly (unsubscribe, stop handler, reveal output).

## [0.0.1] - 2025-11-17

### Added

- `.nats` document parser with support for `SUBSCRIBE`, `PUBLISH`, `REQUEST`, `REPLY`, and `JETSTREAM` blocks plus headers, payload templating, and `randomId()` helpers.
- CodeLens runner that starts subscriptions, reply handlers, JetStream pulls, and ad-hoc publish/request actions directly from the editor.
- Structured output channels, connection-aware status bar updates, and a quick connection reset menu.
- Environment-scoped variable tree view with `{{token}}` and `{{env:VAR_NAME}}` substitutions consumed by the session layer.
- JetStream durable pull command with batch size and timeout overrides mapped from headers.
- CI workflow covering formatting, linting, typing, unit tests, e2e tests, integration harness, and a gated Marketplace publish job for tagged releases.
