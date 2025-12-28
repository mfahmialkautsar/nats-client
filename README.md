# NATS Client for VS Code

[![CI](https://github.com/mfahmialkautsar/vscode-nats-client/actions/workflows/ci.yml/badge.svg)](https://github.com/mfahmialkautsar/vscode-nats-client/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/mfahmialkautsar.nats-client.svg)](https://marketplace.visualstudio.com/items?itemName=mfahmialkautsar.nats-client)
[![License](https://img.shields.io/github/license/mfahmialkautsar/vscode-nats-client)](LICENSE)

Author `.nats` files and run NATS actions from the editor, in a REST Client-style workflow.

## Main Features

- Send NATS actions from CodeLens in `.nats` files.
- Compose multiple actions in one file with `###` delimiters.
- JetStream support (`JSPUBLISH`, `JSCONSUME`) and a `JetStream Explorer` view.
- Variables with completion and hover: `{{token}}` (stored in `NATS Variables`) and `{{env:NAME}}` (OS environment).
- Structured output channels (main output + per-subject channels).
- Connection management UI for saved and ad-hoc connections.

## Usage

Create a `.nats` file and write an action block.

```nats
REQUEST nats://localhost:4222/lab.echo
NATS-Timeout: 5000
Trace-Id: randomId()

{
	"id": 1,
	"subject": "cpu"
}
```

Run the action using the CodeLens shown above the block.

### Multiple actions in one file

Use `###` to separate actions:

```nats
PUBLISH nats://localhost:4222/lab.events

{"event":"start"}

###

REQUEST nats://localhost:4222/lab.echo
NATS-Timeout: 5000

{"hello":"world"}
```

## Install

Press `F1`, type `ext install`, then search for `mfahmialkautsar.nats-client`.

## Making NATS actions

Each action block follows a request-line + headers + optional body format.

### Request line

The first non-empty line is the action line.

```nats
SUBSCRIBE nats://localhost:4222/lab.events

PUBLISH nats://localhost:4222/lab.events

REQUEST nats://localhost:4222/lab.echo

REPLY nats://localhost:4222/lab.echo
```

### Headers

- `NATS-*` headers configure action/session behavior (for example `NATS-Timeout`, server overrides, JetStream stream/durable).
- Other headers are forwarded as message headers.

### Body

If present, the body is everything after the first blank line.

## JetStream

JetStream actions are supported in `.nats` files.

```nats
@url = nats://localhost:4222
@stream = orders
@subject = orders.new
@consumer = monitor

JSPUBLISH {{url}}/{{subject}}
NATS-Stream: {{stream}}

{
  "id": "order-123",
  "status": "created"
}

###

JSCONSUME {{url}}/{{stream}}/{{consumer}}
```

See `examples/jetstream.nats` for a complete, runnable example.

### JetStream Explorer

The `JetStream Explorer` view provides actions for streams and consumers:

- Refresh
- Create / Update / Delete Stream
- Create / Update / Delete Consumer
- View Stream Info / View Consumer Info

## Variables

Variables are resolved before running actions:

- `{{name}}`: resolved from the active environment in the `NATS Variables` Explorer view.
- `{{env:NAME}}`: resolved from OS environment variables.

You can manage environments/variables from the `NATS Variables` view title buttons and context menus.

## Views and commands

Explorer views:

- `NATS Variables`
- `JetStream Explorer`

Common commands:

- `NATS: Manage Connections`
- `NATS: Reset Connections`
- `NATS: Show Output`
- `NATS: Show Subscriptions`
- `NATS: Show Reply Handlers`

## Configuration

| Setting                       | Default | Description                                                                                           |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `natsClient.requestTimeoutMs` | `15000` | Default timeout in milliseconds for request/response operations when `NATS-Timeout` is not specified. |

## Examples

Ready-to-run flows live under `examples/`:

- `examples/pub-sub.nats`
- `examples/request-reply.nats`
- `examples/jetstream.nats`

## Development workflow

```bash
bun install
bun run watch
bun run test
```

## Feedback

- Issues: https://github.com/mfahmialkautsar/vscode-nats-client/issues
