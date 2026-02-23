import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export function buildWebviewCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `font-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    `media-src ${cspSource} data:`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src blob:",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

export async function getWorkspaceCustomCss(documentUri: vscode.Uri): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('offlineMarkdownViewer', documentUri);
  const inspect = cfg.inspect<string>('preview.customCssPath');
  const relPath = inspect?.workspaceFolderValue ?? inspect?.workspaceValue;
  if (!relPath || !relPath.trim()) {
    return undefined;
  }

  const folder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!folder) {
    return undefined;
  }

  const target = vscode.Uri.joinPath(folder.uri, relPath);
  const relative = path.relative(folder.uri.fsPath, target.fsPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(target.fsPath) !== '.css') {
    void vscode.window.showWarningMessage('Ignoring custom CSS path because it is not a workspace-local .css file.');
    return undefined;
  }

  try {
    return await fs.readFile(target.fsPath, 'utf8');
  } catch {
    void vscode.window.showWarningMessage(`Could not read custom CSS file: ${relPath}`);
    return undefined;
  }
}

export async function confirmSanitizeDisabled(documentUri?: vscode.Uri): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration('offlineMarkdownViewer', documentUri);
  const enabled = cfg.get<boolean>('sanitizeHtml', true);
  if (enabled) {
    return true;
  }
  const answer = await vscode.window.showWarningMessage(
    'HTML sanitization is disabled. This can allow unsafe content in preview. Continue?',
    { modal: true },
    'Continue'
  );
  return answer === 'Continue';
}

export function inlineCssTag(cssText: string, nonce: string): string {
  const safeCss = cssText.replace(/<\/style/gi, '<\\/style');
  return `<style nonce="${nonce}">\n${safeCss}\n</style>`;
}
