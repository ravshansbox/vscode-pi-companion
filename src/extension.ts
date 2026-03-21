import * as vscode from 'vscode';
import { IDEServer } from './ide-server';

let ideServer: IDEServer | undefined;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('PI Companion');
  log('Extension activated');

  const server = new IDEServer(log, outputChannel);
  ideServer = server;

  // Start server immediately
  server.start(context).then(() => {
    log(`Server started on port ${server.getPort()}`);
  }).catch((err) => {
    log(`Failed to start server: ${err}`);
  });

  // Create status bar button
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '$(terminal) Run PI';
  statusBarItem.tooltip = 'Run PI in terminal';
  statusBarItem.command = 'pi-companion.run';
  statusBarItem.show();

  // Register commands
  context.subscriptions.push(
    statusBarItem,

    vscode.commands.registerCommand('pi-companion.run', () => {
      runPiInTerminal();
    }),

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

function runPiInTerminal() {
  const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('PI');
  terminal.show();
  terminal.sendText('pi');
}

export function deactivate() {
  log('Extension deactivated');
  ideServer?.stop();
  statusBarItem?.dispose();
}

function log(message: string) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}
