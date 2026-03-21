"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ide_server_1 = require("./ide-server");
let ideServer;
let outputChannel;
let statusBarItem;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('PI Companion');
    log('Extension activated');
    const server = new ide_server_1.IDEServer(log, outputChannel);
    ideServer = server;
    // Start server immediately
    server.start(context).then(() => {
        log(`Server started on port ${server.getPort()}`);
    }).catch((err) => {
        log(`Failed to start server: ${err}`);
    });
    // Create status bar button
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(terminal) Run PI';
    statusBarItem.tooltip = 'Run PI in terminal';
    statusBarItem.command = 'pi-companion.run';
    statusBarItem.show();
    // Register commands
    context.subscriptions.push(statusBarItem, vscode.commands.registerCommand('pi-companion.run', () => {
        runPiInTerminal();
    }), vscode.commands.registerCommand('pi-companion.start', async () => {
        if (ideServer?.isRunning()) {
            vscode.window.showInformationMessage('PI Companion: Server already running');
            return;
        }
        await ideServer?.start(context);
        vscode.window.showInformationMessage(`PI Companion: Server started on port ${ideServer?.getPort()}`);
    }), vscode.commands.registerCommand('pi-companion.stop', async () => {
        await ideServer?.stop();
        vscode.window.showInformationMessage('PI Companion: Server stopped');
    }), vscode.commands.registerCommand('pi-companion.status', () => {
        const running = ideServer?.isRunning();
        const port = ideServer?.getPort();
        vscode.window.showInformationMessage(`PI Companion: ${running ? `Running on port ${port}` : 'Stopped'}`);
    }));
}
function runPiInTerminal() {
    // Create new terminal so shell rc files (including direnv hook) are sourced
    const terminal = vscode.window.createTerminal({
        name: 'PI',
        isTransient: true
    });
    terminal.show();
    // Ensure direnv is loaded, then run pi
    terminal.sendText('eval "$(direnv export json 2>/dev/null)" 2>/dev/null; pi');
}
function deactivate() {
    log('Extension deactivated');
    ideServer?.stop();
    statusBarItem?.dispose();
}
function log(message) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    outputChannel?.appendLine(`[${timestamp}] ${message}`);
}
