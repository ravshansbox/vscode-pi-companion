/**
 * PI Companion Extension
 * 
 * Connects to the VS Code extension via SSE for real-time context updates.
 * No polling, instant updates, no tool calls visible.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { execSync } from "child_process";
import { Type } from "@sinclair/typebox";

function isLocalPackageInstall(): boolean {
  const filename = __filename;
  return !filename.includes(`${path.sep}.pi${path.sep}agent${path.sep}git${path.sep}`)
    && !filename.includes(`${path.sep}.pi${path.sep}git${path.sep}`);
}

// Check if running in VS Code integrated terminal
function isRunningInVSCode(): boolean {
  return process.env.TERM_PROGRAM === 'vscode';
}

// Install VS Code extension from marketplace
function installFromMarketplace(ctx: ExtensionContext): void {
  try {
    execSync('code --install-extension ravshansbox.vscode-pi-companion --force', { stdio: 'pipe' });
    ctx.ui.notify("PI Companion: VS Code extension installed. Reload window to activate.", "info");
  } catch {
    // Silently ignore
  }
}

// Check if extension is installed
function isExtensionInstalled(): boolean {
  try {
    const result = execSync('code --list-extensions', { encoding: 'utf8' });
    return result.includes('ravshansbox.vscode-pi-companion');
  } catch {
    return false;
  }
}

// Install/update VS Code extension if running in VS Code terminal
async function installVSCodeExtension(ctx: ExtensionContext): Promise<void> {
  if (!isRunningInVSCode()) {
    return;
  }
  
  const isInstalled = isExtensionInstalled();
  
  if (isInstalled) {
    // Already installed - check for updates, but skip for local package installs
    if (!isLocalPackageInstall()) {
      const latestVersion = await getLatestVersion();
      if (latestVersion) {
        console.log(`[PI Companion] Update available: v${latestVersion}`);
        console.log(`[PI Companion] Run: pi install git:github.com/ravshansbox/vscode-pi-companion`);
      }
    }
    return;
  }
  
  // Not installed - install from marketplace
  installFromMarketplace(ctx);
}

// Get latest version from GitHub
async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/repos/ravshansbox/vscode-pi-companion/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const release = await response.json() as { tag_name?: string };
    return release.tag_name?.replace('v', '') || null;
  } catch {
    return null;
  }
}

interface IdeContext {
  workspaceState: {
    openFiles: Array<{
      path: string;
      timestamp: number;
      isActive?: boolean;
      selectedText?: string;
      cursor?: { line: number; character: number };
      selectionStart?: { line: number; character: number };
      selectionEnd?: { line: number; character: number };
      content?: string;
    }>;
    isTrusted: boolean;
    workspacePath: string;
  };
}

let currentContext: IdeContext | undefined;
let currentCtx: ExtensionContext | undefined;
let lastWidgetKey = "";
let widgetDebounceTimer: NodeJS.Timeout | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
let sseRequest: http.ClientRequest | undefined;

function getPort(): number | undefined {
  const configDir = path.join(os.tmpdir(), "pi-companion");

  try {
    const files = fs.readdirSync(configDir);
    const connectionFiles = files
      .filter((f) => f.startsWith("connection-") && f.endsWith(".json"))
      .map((f) => ({
        name: f,
        path: path.join(configDir, f),
        mtime: fs.statSync(path.join(configDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (connectionFiles.length > 0) {
      const content = fs.readFileSync(connectionFiles[0].path, "utf-8");
      const info = JSON.parse(content);
      return info.port;
    }
  } catch {
    // No connection files found
  }
  return undefined;
}

function updateWidget(): void {
  if (!currentCtx) return;
  
  if (!currentContext || !currentContext.workspaceState.openFiles.length) {
    currentCtx.ui.setWidget("pi-companion", ["PI Companion: No files open"]);
    return;
  }

  const { workspaceState } = currentContext;
  const lines: string[] = [];

  const activeFile = workspaceState.openFiles.find((f) => f.isActive);

  if (activeFile) {
    const filename = activeFile.path.split("/").pop() || activeFile.path;
    
    // Build location info - ONLY show when text is actually selected
    let location = "";
    if (activeFile.selectionStart && activeFile.selectionEnd) {
      const start = activeFile.selectionStart.line;
      const end = activeFile.selectionEnd.line;
      if (start === end) {
        location = ` L${start}`;
      } else {
        location = ` L${start}:${end}`;
      }
    }
    // Don't show cursor position when nothing is selected
    
    lines.push(`📄 ${filename}${location}`);
  }

  const otherCount = workspaceState.openFiles.length - 1;
  if (otherCount > 0) {
    lines.push(`   +${otherCount} more file${otherCount > 1 ? "s" : ""} open`);
  }

  const widgetKey = lines.join("|");
  
  // Debounce widget updates to avoid flickering during rapid selection changes
  if (widgetDebounceTimer) {
    clearTimeout(widgetDebounceTimer);
  }
  
  widgetDebounceTimer = setTimeout(() => {
    if (widgetKey !== lastWidgetKey) {
      lastWidgetKey = widgetKey;
      currentCtx!.ui.setWidget("pi-companion", lines);
    }
    widgetDebounceTimer = undefined;
  }, 50); // Wait 50ms after last update
}

function connectSSE(): void {
  const port = getPort();
  if (!port) return;

  // Close existing connection
  if (sseRequest) {
    sseRequest.destroy();
    sseRequest = undefined;
  }

  const url = new URL(`http://127.0.0.1:${port}/context/stream`);
  
  sseRequest = http.get({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
  }, (res) => {
    let buffer = "";
    
    res.on("data", (chunk: string) => {
      buffer += chunk;
      
      // Process complete SSE messages
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data && data !== "[object Object]") {
            try {
              const parsed = JSON.parse(data);
              currentContext = parsed;
              updateWidget();
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    });

    res.on("end", () => {
      scheduleReconnect();
    });

    res.on("error", () => {
      scheduleReconnect();
    });
  });

  sseRequest.on("error", () => {
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer || !currentCtx) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectSSE();
  }, 2000);
}

export default function (pi: ExtensionAPI) {
  // Inject IDE context before each prompt
  pi.on("before_agent_start", async (event, ctx) => {
    if (!currentContext) return;
    
    const activeFile = currentContext.workspaceState.openFiles.find((f) => f.isActive);
    if (!activeFile) return;

    let contextText = "";
    
    if (activeFile.selectedText) {
      // Inject selected text
      contextText = `Current selection in ${activeFile.path}:\n\`\`\`\n${activeFile.selectedText}\n\`\`\``;
    } else if (activeFile.content) {
      // Inject full file content for small files, or first 100 lines
      const lines = activeFile.content.split("\n");
      if (lines.length <= 100) {
        contextText = `Current file ${activeFile.path}:\n\`\`\`\n${activeFile.content}\n\`\`\``;
      } else {
        contextText = `Current file ${activeFile.path} (first 100 lines):\n\`\`\`\n${lines.slice(0, 100).join("\n")}\n\`\`\``;
      }
    }

    if (contextText) {
      return {
        message: {
          customType: "pi-companion",
          content: contextText,
          display: false, // Don't show in chat history
        },
      };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;

    // Auto-install/update VS Code extension if needed
    installVSCodeExtension(ctx);

    const port = getPort();
    if (port) {
      ctx.ui.notify("PI Companion: Connected to VS Code", "info");
      connectSSE();
    } else {
      ctx.ui.notify("PI Companion: VS Code companion server not running. Run 'PI Companion: Start Server' in VS Code.", "warning");
    }
  });

  pi.on("session_shutdown", async () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (sseRequest) {
      sseRequest.destroy();
      sseRequest = undefined;
    }
  });

  // Register tools
  pi.registerTool({
    name: "get_ide_context",
    label: "Get IDE Context",
    description: "Get the current IDE context: open files, cursor position, and selection",
    parameters: Type.Object({}),
    async execute() {
      if (!currentContext) {
        return {
          content: [{ type: "text", text: "No IDE context available. Make sure the PI Companion VS Code extension is installed and running." }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(currentContext, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "get_current_file",
    label: "Get Current File",
    description: "Get the content of the currently active file in the IDE",
    parameters: Type.Object({}),
    async execute() {
      if (!currentContext) {
        return { content: [{ type: "text", text: "No IDE context available" }], details: {} };
      }
      const activeFile = currentContext.workspaceState.openFiles.find((f) => f.isActive);
      if (!activeFile) {
        return { content: [{ type: "text", text: "No active file" }], details: {} };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({
          path: activeFile.path,
          cursor: activeFile.cursor,
          selection: activeFile.selectedText,
          content: activeFile.content,
        }, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "list_open_files",
    label: "List Open Files",
    description: "List all files currently open in the IDE",
    parameters: Type.Object({}),
    async execute() {
      if (!currentContext) {
        return { content: [{ type: "text", text: "No IDE context available" }], details: {} };
      }
      const files = currentContext.workspaceState.openFiles.map((f) => ({
        path: f.path,
        isActive: f.isActive,
        cursor: f.cursor,
        hasSelection: !!f.selectedText,
      }));
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }], details: {} };
    },
  });
}
