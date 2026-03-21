import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';

const IDE_SERVER_PORT_ENV_VAR = 'PI_COMPANION_PORT';
const IDE_WORKSPACE_PATH_ENV_VAR = 'PI_COMPANION_WORKSPACE_PATH';
const IDE_AUTH_TOKEN_ENV_VAR = 'PI_COMPANION_AUTH_TOKEN';

export class IDEServer {
  private server: ReturnType<typeof express> | undefined;
  private httpServer: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  private port: number = 0;
  private authToken: string = '';
  private context: vscode.ExtensionContext | undefined;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private mcpServer: McpServer | undefined;
  private openFilesManager: OpenFilesManager | undefined;
  private log: (message: string) => void = console.log;

  constructor(log: (message: string) => void, _outputChannel: vscode.OutputChannel) {
    this.log = log;
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.httpServer !== undefined;
  }

  async start(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.authToken = randomUUID();

    // Create MCP server
    this.mcpServer = this.createMcpServer();

    // Create OpenFilesManager
    this.openFilesManager = new OpenFilesManager(context);
    this.openFilesManager.onDidChange(() => {
      this.broadcastIdeContextUpdate();
    });

    // Create Express app
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(cors());

    // Context endpoints (no auth required)
    app.get('/context', (_req, res) => {
      const context = this.openFilesManager?.getState();
      res.json(context);
    });

    // SSE endpoint for real-time context updates (no auth required)
    const sseClients = new Set<{ res: Response }>();
    app.get('/context/stream', (_req, res) => {
      this.log(`SSE client connected. Total: ${sseClients.size + 1}`);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const client = { res };
      sseClients.add(client);

      // Send initial context
      const context = this.openFilesManager?.getState();
      res.write(`data: ${JSON.stringify(context)}\n\n`);

      _req.on('close', () => {
        sseClients.delete(client);
        this.log(`SSE client disconnected. Total: ${sseClients.size}`);
      });
    });

    // Store SSE clients for broadcasting
    (this as any)._sseClients = sseClients;

    // Auth middleware (only for MCP endpoint)
    app.use((req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).send('Unauthorized');
        return;
      }
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1] !== this.authToken) {
        res.status(401).send('Unauthorized');
        return;
      }
      next();
    });

    // MCP endpoint
    app.post('/mcp', async (req: Request, res: Response) => {
      let transport: StreamableHTTPServerTransport;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && this.transports.has(sessionId)) {
        transport = this.transports.get(sessionId)!;
      } else if (!sessionId && req.body?.method === 'initialize') {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            this.log(`Session initialized: ${newSessionId}`);
            this.transports.set(newSessionId, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            this.transports.delete(transport.sessionId);
          }
        };

        await this.mcpServer!.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Invalid request' },
          id: null,
        });
        return;
      }

      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        this.log(`Error handling request: ${error}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          });
        }
      }
    });

    app.get('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      const transport = this.transports.get(sessionId)!;
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        this.log(`Error handling session request: ${error}`);
      }
    });

    // Start HTTP server
    return new Promise((resolve, reject) => {
      this.httpServer = app.listen(0, '127.0.0.1', async () => {
        const address = this.httpServer!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          this.log(`IDE server listening on http://127.0.0.1:${this.port}`);
          
          // Write connection info to file
          await this.writeConnectionInfo();
          
          // Set environment variables
          if (this.context) {
            this.context.environmentVariableCollection.replace(IDE_SERVER_PORT_ENV_VAR, this.port.toString());
            this.context.environmentVariableCollection.replace(IDE_WORKSPACE_PATH_ENV_VAR, this.getWorkspacePath());
            this.context.environmentVariableCollection.replace(IDE_AUTH_TOKEN_ENV_VAR, this.authToken);
          }
          
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.httpServer.on('error', (error: Error) => {
        this.log(`Server error: ${error}`);
        reject(error);
      });
    });
  }

  private async writeConnectionInfo(): Promise<void> {
    const configDir = path.join(os.tmpdir(), 'pi-companion');
    const pid = process.ppid || process.pid;
    const infoFile = path.join(configDir, `connection-${pid}.json`);

    try {
      await fs.promises.mkdir(configDir, { recursive: true });
      const info = {
        port: this.port,
        workspacePath: this.getWorkspacePath(),
        authToken: this.authToken,
      };
      await fs.promises.writeFile(infoFile, JSON.stringify(info, null, 2));
      await fs.promises.chmod(infoFile, 0o600);
      this.log(`Wrote connection info to ${infoFile}`);
    } catch (error) {
      this.log(`Failed to write connection info: ${error}`);
    }
  }

  private getWorkspacePath(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders.map(f => f.uri.fsPath).join(path.delimiter);
    }
    return '';
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      {
        name: 'pi-companion',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Tool: get_open_files
    // Using 'tool' method with type assertion to avoid TypeScript/Zod compatibility issues
    (server as any).tool(
      'get_open_files',
      'Get all open files with their content, cursor position, and selection',
      {},
      async () => {
        const context = this.openFilesManager?.getState();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      },
    );

    // Tool: read_file
    (server as any).tool(
      'read_file',
      'Read the contents of a file',
      { path: { type: 'string', description: 'Absolute path to the file' } },
      async (args: { path: string }) => {
        try {
          const content = await fs.promises.readFile(args.path, 'utf-8');
          return {
            content: [
              {
                type: 'text',
                text: content,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error reading file: ${error}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // Tool: goto
    (server as any).tool(
      'goto',
      'Open a file at a specific location',
      {
        path: { type: 'string', description: 'Absolute path to the file' },
        line: { type: 'number', description: 'Line number (1-based)' },
        character: { type: 'number', description: 'Character position (1-based)' },
      },
      async (args: { path: string; line?: number; character?: number }) => {
        try {
          const uri = vscode.Uri.file(args.path);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: false,
          });

          if (args.line !== undefined) {
            const position = new vscode.Position(
              Math.max(0, args.line - 1),
              Math.max(0, (args.character || 1) - 1),
            );
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter,
            );
          }

          return {
            content: [
              {
                type: 'text',
                text: `Opened ${args.path}${args.line ? `:${args.line}` : ''}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error opening file: ${error}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    return server;
  }

  private broadcastIdeContextUpdate(): void {
    if (!this.openFilesManager) return;

    const context = this.openFilesManager.getState();

    // Send to SSE clients
    const sseClients = (this as any)._sseClients as Set<{ res: Response }> | undefined;
    if (sseClients) {
      for (const client of sseClients) {
        try {
          client.res.write(`data: ${JSON.stringify(context)}\n\n`);
        } catch (error) {
          this.log(`SSE write error: ${error}`);
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = undefined;
    }

    if (this.context) {
      this.context.environmentVariableCollection.clear();
    }

    // Clean up connection file
    const configDir = path.join(os.tmpdir(), 'pi-companion');
    const pid = process.ppid || process.pid;
    const infoFile = path.join(configDir, `connection-${pid}.json`);
    fs.promises.unlink(infoFile).catch(() => {});

    this.log('Server stopped');
  }
}

// OpenFilesManager must be imported at runtime to avoid circular dependency
import { OpenFilesManager } from './open-files-manager';
