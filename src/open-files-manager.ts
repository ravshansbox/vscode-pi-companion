import * as vscode from 'vscode';
import * as fs from 'fs/promises';

const MAX_FILES = 10;
const MAX_SELECTED_TEXT_LENGTH = 16384;

interface File {
  path: string;
  timestamp: number;
  isActive?: boolean;
  selectedText?: string;
  cursor?: {
    line: number;
    character: number;
  };
  selectionStart?: {
    line: number;
    character: number;
  };
  selectionEnd?: {
    line: number;
    character: number;
  };
  content?: string;
}

interface IdeContext {
  workspaceState: {
    openFiles: File[];
    isTrusted: boolean;
    workspacePath: string;
  };
}

/**
 * Keeps track of the workspace state: open files, cursor position, and selected text.
 */
export class OpenFilesManager {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private debounceTimer: NodeJS.Timeout | undefined;
  private openFiles: File[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
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
          } else {
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

    context.subscriptions.push(
      editorWatcher,
      selectionWatcher,
      closeWatcher,
      deleteWatcher,
      renameWatcher,
      saveWatcher,
    );

    // Add current active file on startup
    if (
      vscode.window.activeTextEditor &&
      this.isFileUri(vscode.window.activeTextEditor.document.uri)
    ) {
      this.addOrMoveToFront(vscode.window.activeTextEditor);
    }
  }

  private isFileUri(uri: vscode.Uri): boolean {
    return uri.scheme === 'file';
  }

  private addOrMoveToFront(editor: vscode.TextEditor) {
    // Deactivate previous active file
    const currentActive = this.openFiles.find((f) => f.isActive);
    if (currentActive) {
      currentActive.isActive = false;
      currentActive.cursor = undefined;
      currentActive.selectedText = undefined;
    }

    // Remove if exists
    const index = this.openFiles.findIndex(
      (f) => f.path === editor.document.uri.fsPath,
    );
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

  private remove(uri: vscode.Uri) {
    const index = this.openFiles.findIndex((f) => f.path === uri.fsPath);
    if (index !== -1) {
      this.openFiles.splice(index, 1);
    }
  }

  private rename(oldUri: vscode.Uri, newUri: vscode.Uri) {
    const file = this.openFiles.find((f) => f.path === oldUri.fsPath);
    if (file) {
      file.path = newUri.fsPath;
    }
  }

  private async updateActiveContext(editor: vscode.TextEditor) {
    const file = this.openFiles.find(
      (f) => f.path === editor.document.uri.fsPath,
    );
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
    } else {
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

  private fireWithDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.onDidChangeEmitter.fire();
    }, 50);
  }

  getState(): IdeContext {
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
      .filter((p): p is string => p !== null);

    const actualOpenFiles = this.openFiles.filter((f) =>
      openTextEditors.includes(f.path)
    );

    return {
      workspaceState: {
        openFiles: actualOpenFiles,
        isTrusted: vscode.workspace.isTrusted,
        workspacePath,
      },
    };
  }
}
