# Change Log

All notable changes to the "nats-client" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

This project is licensed under the MIT License.

## [0.0.1] - 2025-11-17

### Added

- `.nats` document parser with support for `SUBSCRIBE`, `PUBLISH`, `REQUEST`, `REPLY`, and `JETSTREAM` blocks plus headers, payload templating, and `randomId()` helpers.
- CodeLens runner that starts subscriptions, reply handlers, JetStream pulls, and ad-hoc publish/request actions directly from the editor.
- Structured output channels, connection-aware status bar updates, and a quick connection reset menu.
- Environment-scoped variable tree view with `{{token}}` and `{{env:VAR_NAME}}` substitutions consumed by the session layer.
- JetStream durable pull command with batch size and timeout overrides mapped from headers.
- CI workflow covering formatting, linting, typing, unit tests, e2e tests, integration harness, and a gated Marketplace publish job for tagged releases.
