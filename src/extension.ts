import * as vscode from 'vscode';
import { IDEServer } from './ide-server';

let ideServer: IDEServer | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('PI Companion');
  log('Extension activated');

  const server = new IDEServer(log, outputChannel);
  ideServer = server;

  // Start server immediately
  server.start(context).then(() => {
    log(`Server started on port ${server.getPort()}`);
    vscode.window.showInformationMessage(`PI Companion: Server running on port ${server.getPort()}`);
  }).catch((err) => {
    log(`Failed to start server: ${err}`);
    vscode.window.showErrorMessage(`PI Companion: Failed to start server`);
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pi-companion.start', async () => {
      if (ideServer?.isRunning()) {
        vscode.window.showInformationMessage('PI Companion: Server already running');
        return;
      }
      await ideServer?.start(context);
      vscode.window.showInformationMessage(`PI Companion: Server started on port ${ideServer?.getPort()}`);
    }),

    vscode.commands.registerCommand('pi-companion.stop', async () => {
      await ideServer?.stop();
      vscode.window.showInformationMessage('PI Companion: Server stopped');
    }),

    vscode.commands.registerCommand('pi-companion.status', () => {
      const running = ideServer?.isRunning();
      const port = ideServer?.getPort();
      vscode.window.showInformationMessage(
        `PI Companion: ${running ? `Running on port ${port}` : 'Stopped'}`
      );
    }),
  );
}

export function deactivate() {
  log('Extension deactivated');
  ideServer?.stop();
}

function log(message: string) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}
