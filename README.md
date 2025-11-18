# NATS Client for VS Code

[![CI](https://github.com/mfahmialkautsar/vscode-nats-client/actions/workflows/ci.yml/badge.svg)](https://github.com/mfahmialkautsar/vscode-nats-client/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/mfahmialkautsar.nats-client.svg)](https://marketplace.visualstudio.com/items?itemName=mfahmialkautsar.nats-client)
[![License](https://img.shields.io/github/license/mfahmialkautsar/vscode-nats-client)](LICENSE)

A VS Code workflow inspired by the HTTP Client: author `.nats` files, run CodeLens actions, visualize replies, and manage connection variables without leaving the editor.

## Highlights

- **NATS-native scripts** – Parse `SUBSCRIBE`, `PUBLISH`, `REQUEST`, `REPLY`, and `JETSTREAM` blocks with headers, payloads, and metadata via `src/core/nats-document-parser.ts`.
- **One-click execution** – `src/features/code-lens` attaches CodeLens controls that start or stop subscriptions, fire requests, publish payloads, and pull JetStream batches without switching focus.
- **Structured logging** – `OutputChannelRegistry` multiplexes per-subject logs while `appendLogBlock` groups meta data, headers, and payload previews in the primary output channel.
- **JetStream tooling** – The `nats.jetStreamPull` command (see `register-jetstream-pull-command.ts`) hydrates durable pullers that honor timeout and batch headers.
- **Environment-aware variables** – Manage secrets and templated tokens via the `NATS Variables` tree view backed by `VariableStore`, including `{{token}}` substitutions and `{{env:NAME}}` lookups.
- **Status-aware sessions** – `StatusBarController` keeps an at-a-glance connection count, while `NatsSession` tracks active subscriptions and reply handlers so you can tear them down quickly.

## Script format

Each action block mimics the HTTP Client grammar:

```nats
REQUEST nats://localhost:4222/lab.echo
NATS-Timeout: 5000
Trace-Id: randomId()

{
	"id": randomId(),
	"subject": "cpu"
}
```

- Headers prefixed with `NATS-` configure connection metadata (server overrides, JetStream durable names, batch sizes, etc.).
- Trace headers (`Trace-Id`, `Responder-Id`, …) are forwarded to the server.
- Variables defined in the tree view can be referenced via `{{token}}`; environment variables use `{{env:NAME}}`.
- Use triple hashes (`###`) to separate multiple actions inside the same document.

## Examples

Ready-to-run flows live under `examples/`:

- `examples/pub-sub.nats` – two concurrent subscriptions plus matching publish blocks for quick smoke tests.
- `examples/request-reply.nats` – combines reply handlers with literal and JSON requests, showing how `$msg` templates render responses.
- `examples/jetstream-pull.nats` – demonstrates durable JetStream pulls (`NATS-Stream`, `NATS-Durable`, and `NATS-Batch`).

Open an example, hover the CodeLens for the action you want, and execute the command to stream results into the output channel.

## Variables and templating

- The `NATS Variables` tree appears in the Explorer view (`NATS Variables`). Use the view title buttons and the item/context menus to add, edit, delete, copy, and set the active environment.
- The tree stores named variables per environment; the active environment is used when resolving tokens before requests, publishes, subscriptions, and reply handlers.
- Reference variables using `{{name}}`; use `{{env:NAME}}` to read OS environment variables.
- Built-in helpers include `randomId()` and `$json.*` / `$msg.*` shortcuts evaluated by `nats-actions` and `nats-session` for templated replies.

## Features

The extension contributes the following entry points:

- Inline CodeLens controls appear above action blocks in `.nats` files; these are the primary way to run subscriptions, requests, publishes, and reply handlers.
- A `NATS Variables` Explorer view provides add/edit/delete and copy actions for environments and variables via view title buttons and context menus.
- The status bar shows the current active connection count. A connection management QuickPick is available via the `NATS: Manage Connections` command (registered by the extension).
- Status bar indicator that surfaces active connection counts.

## Configuration

| Setting                       | Default | Description                                                                              |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `natsClient.requestTimeoutMs` | `15000` | Fallback timeout for `REQUEST` and JetStream pull actions when `NATS-Timeout` is absent. |
| `natsClient.autoRevealOutput` | `false` | Automatically reveals the main output channel after every publish or request.            |

## Development workflow

```bash
bun install
bun run watch                 # incremental builds while editing
bun run verify                # format, lint, typecheck, and unit tests
bun run test:e2e              # Vitest e2e suite
bun run integration:test      # VS Code harness (xvfb on CI)
```

## Contributing & support

- Issues: [github.com/mfahmialkautsar/vscode-nats-client/issues](https://github.com/mfahmialkautsar/vscode-nats-client/issues)
- Discussions and feature requests are welcome—attach example `.nats` files when possible so we can reproduce flows quickly.
