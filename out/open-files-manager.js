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
exports.OpenFilesManager = void 0;
const vscode = __importStar(require("vscode"));
const MAX_FILES = 10;
const MAX_SELECTED_TEXT_LENGTH = 16384;
/**
 * Keeps track of the workspace state: open files, cursor position, and selected text.
 */
class OpenFilesManager {
    constructor(context) {
        this.context = context;
        this.onDidChangeEmitter = new vscode.EventEmitter();
        this.onDidChange = this.onDidChangeEmitter.event;
        this.openFiles = [];
        // Watch for active editor changes
        const editorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && this.isFileUri(editor.document.uri)) {
                this.addOrMoveToFront(editor);
                this.fireWithDebounce();
            }
        });
        // Watch for selection changes
        const selectionWatcher = vscode.window.onDidChangeTextEditorSelection((event) => {
            if (this.isFileUri(event.textEditor.document.uri)) {
                this.updateActiveContext(event.textEditor);
                this.fireWithDebounce();
            }
        });
        // Watch for file close
        const closeWatcher = vscode.workspace.onDidCloseTextDocument((document) => {
            if (this.isFileUri(document.uri)) {
                this.remove(document.uri);
                this.fireWithDebounce();
            }
        });
        // Watch for file delete
        const deleteWatcher = vscode.workspace.onDidDeleteFiles((event) => {
            for (const uri of event.files) {
                if (this.isFileUri(uri)) {
                    this.remove(uri);
                }
            }
            this.fireWithDebounce();
        });
        // Watch for file rename
        const renameWatcher = vscode.workspace.onDidRenameFiles((event) => {
            for (const { oldUri, newUri } of event.files) {
                if (this.isFileUri(oldUri)) {
                    if (this.isFileUri(newUri)) {
                        this.rename(oldUri, newUri);
                    }
                    else {
                        this.remove(oldUri);
                    }
                }
            }
            this.fireWithDebounce();
        });
        // Watch for file save (to update content)
        const saveWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
            if (this.isFileUri(document.uri)) {
                const file = this.openFiles.find((f) => f.path === document.uri.fsPath);
                if (file) {
                    file.content = document.getText();
                }
                this.fireWithDebounce();
            }
        });
        context.subscriptions.push(editorWatcher, selectionWatcher, closeWatcher, deleteWatcher, renameWatcher, saveWatcher);
        // Add current active file on startup
        if (vscode.window.activeTextEditor &&
            this.isFileUri(vscode.window.activeTextEditor.document.uri)) {
            this.addOrMoveToFront(vscode.window.activeTextEditor);
        }
    }
    isFileUri(uri) {
        return uri.scheme === 'file';
    }
    addOrMoveToFront(editor) {
        // Deactivate previous active file
        const currentActive = this.openFiles.find((f) => f.isActive);
        if (currentActive) {
            currentActive.isActive = false;
            currentActive.cursor = undefined;
            currentActive.selectedText = undefined;
        }
        // Remove if exists
        const index = this.openFiles.findIndex((f) => f.path === editor.document.uri.fsPath);
        if (index !== -1) {
            this.openFiles.splice(index, 1);
        }
        // Add to front as active
        this.openFiles.unshift({
            path: editor.document.uri.fsPath,
            timestamp: Date.now(),
            isActive: true,
        });
        // Enforce max files
        if (this.openFiles.length > MAX_FILES) {
            this.openFiles.pop();
        }
        this.updateActiveContext(editor);
    }
    remove(uri) {
        const index = this.openFiles.findIndex((f) => f.path === uri.fsPath);
        if (index !== -1) {
            this.openFiles.splice(index, 1);
        }
    }
    rename(oldUri, newUri) {
        const file = this.openFiles.find((f) => f.path === oldUri.fsPath);
        if (file) {
            file.path = newUri.fsPath;
        }
    }
    async updateActiveContext(editor) {
        const file = this.openFiles.find((f) => f.path === editor.document.uri.fsPath);
        if (!file || !file.isActive) {
            return;
        }
        // Update cursor position (where cursor is)
        if (editor.selection.active) {
            file.cursor = {
                line: editor.selection.active.line + 1,
                character: editor.selection.active.character + 1,
            };
        }
        // Update selection boundaries
        if (!editor.selection.isEmpty) {
            const startLine = Math.min(editor.selection.anchor.line, editor.selection.active.line) + 1;
            const endLine = Math.max(editor.selection.anchor.line, editor.selection.active.line) + 1;
            const startChar = Math.min(editor.selection.anchor.character, editor.selection.active.character) + 1;
            const endChar = Math.max(editor.selection.anchor.character, editor.selection.active.character) + 1;
            file.selectionStart = { line: startLine, character: startChar };
            file.selectionEnd = { line: endLine, character: endChar };
        }
        else {
            file.selectionStart = undefined;
            file.selectionEnd = undefined;
        }
        // Update selected text
        let selectedText = editor.document.getText(editor.selection) || undefined;
        if (selectedText && selectedText.length > MAX_SELECTED_TEXT_LENGTH) {
            selectedText = selectedText.substring(0, MAX_SELECTED_TEXT_LENGTH);
        }
        file.selectedText = selectedText;
        // Update content
        file.content = editor.document.getText();
    }
    fireWithDebounce() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.onDidChangeEmitter.fire();
        }, 50);
    }
    getState() {
        const folders = vscode.workspace.workspaceFolders;
        const workspacePath = folders?.map((f) => f.uri.fsPath).join(',') || '';
        // Only return files that are actually open in editors
        const openTextEditors = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .map((tab) => {
            if (tab.input instanceof vscode.TabInputText) {
                return tab.input.uri.fsPath;
            }
            return null;
        })
            .filter((p) => p !== null);
        const actualOpenFiles = this.openFiles.filter((f) => openTextEditors.includes(f.path));
        return {
            workspaceState: {
                openFiles: actualOpenFiles,
                isTrusted: vscode.workspace.isTrusted,
                workspacePath,
            },
        };
    }
}
exports.OpenFilesManager = OpenFilesManager;
