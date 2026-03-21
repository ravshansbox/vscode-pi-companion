# PI Companion

A VS Code extension that provides an MCP server for sharing IDE context with pi and other agents.

## Features

- **Real-time context tracking**: Monitors open files, cursor position, and selection
- **MCP Protocol**: Standard Model Context Protocol server for any MCP-compatible agent
- **Instant updates**: Pushes context changes to connected agents via SSE
- **Privacy-first**: Auth token required, localhost only

## Architecture

```
┌─────────────────┐     HTTP/SSE     ┌─────────────────┐
│  VS Code        │ ←──────────────→ │  pi / opencode  │
│  Extension      │    MCP Protocol   │  (MCP Client)   │
│                 │                  │                 │
│  - MCP Server   │                  │  - Widget shows │
│  - Context      │                  │    current file │
│    tracking    │                  │  - Tools for    │
│                 │                  │    context      │
└─────────────────┘                  └─────────────────┘
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_open_files` | Get all open files with content, cursor, selection |
| `read_file` | Read any file by absolute path |
| `goto` | Open a file at a specific line/character |

## Development

```bash
npm install
npm run compile
```

Press F5 in VS Code to run the extension in the Extension Development Host.

## Connection

The extension writes connection info to:
```
/tmp/pi-companion/connection-{pid}.json
```

And sets environment variables in spawned terminals:
- `PI_COMPANION_PORT`
- `PI_COMPANION_WORKSPACE_PATH`
- `PI_COMPANION_AUTH_TOKEN`

## pi Extension

The pi extension is installed at `~/.pi/agent/extensions/pi-companion/`. It:
- Connects to the VS Code MCP server automatically
- Shows current file/selection in pi's widget
- Provides `get_ide_context`, `get_current_file`, and `list_open_files` tools
