# VS Code PI Companion

A VS Code extension that provides real-time IDE context (files, selection) to pi and other agents.

## Features

- **Real-time context**: Monitors open files, cursor position, and selection
- **Instant updates**: Pushes context changes via SSE
- **Seamless integration**: Selected lines injected into LLM context automatically
- **Widget display**: Shows current file/selection in pi UI

## Architecture

**VS Code Extension** → SSE ← **pi Extension**

- **VS Code**: Context tracking, SSE server
- **pi**: SSE client, Widget, Context injection

## Installation

### 1. Install pi Extension

```bash
pi install git:github.com/ravshansbox/vscode-pi-companion
```

Or manually:
```bash
mkdir -p ~/.pi/agent/extensions/vscode-pi-companion
git clone git@github.com:ravshansbox/vscode-pi-companion.git ~/.pi/agent/extensions/vscode-pi-companion
cd ~/.pi/agent/extensions/vscode-pi-companion
npm install
```

### 2. Install VS Code Extension

The pi extension will auto-install the VS Code extension when you run `pi` in a VS Code terminal.

Alternatively, install manually:
```bash
# Download the .vsix from releases
code --install-extension vscode-pi-companion.vsix
```

Then reload VS Code window.

## Usage

1. Open a folder in VS Code
2. Open VS Code terminal (`Ctrl+\``)
3. Run `pi`
4. The extension auto-connects and shows current file in widget
5. Select code → widget updates instantly
6. Selected lines are injected into LLM context automatically

## Widget Display

```
📄 filename           # no selection
📄 filename L9        # single line
📄 filename L9:14     # multi-line selection
```

## MCP Tools (for LLM)

| Tool | Description |
|------|-------------|
| `get_ide_context` | Full IDE context |
| `get_current_file` | Current file with selection |
| `list_open_files` | List all open files |

## Development

```bash
# Build VS Code extension
npm install
npm run compile

# Package as .vsix
npx vsce package
```

Press F5 to run in Extension Development Host.
