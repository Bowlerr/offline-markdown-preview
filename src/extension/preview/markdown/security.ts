import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface ResolvedCustomCss {
  cssText?: string;
  key: string;
}

interface CustomCssConfig {
  globalPath?: string;
  workspacePath?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
}

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export function buildWebviewCsp(
  cspSource: string,
  nonce: string,
  options: { allowRemoteImages?: boolean } = {}
): string {
  const imgSources = options.allowRemoteImages
    ? `${cspSource} data: blob: https: http:`
    : `${cspSource} data: blob:`;
  return [
    "default-src 'none'",
    `img-src ${imgSources}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `font-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    `media-src ${cspSource} data:`,
    "object-src 'none'",
    "frame-src 'none'",
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function normalizeConfiguredPath(
  value: string | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getCustomCssConfig(documentUri: vscode.Uri): CustomCssConfig {
  const cfg = vscode.workspace.getConfiguration(
    'offlineMarkdownViewer',
    documentUri
  );
  return {
    globalPath: normalizeConfiguredPath(
      cfg.inspect<string>('preview.globalCustomCssPath')?.globalValue
    ),
    workspacePath: normalizeConfiguredPath(
      cfg.inspect<string>('preview.customCssPath')?.workspaceFolderValue ??
        cfg.inspect<string>('preview.customCssPath')?.workspaceValue
    ),
    workspaceFolder: vscode.workspace.getWorkspaceFolder(documentUri)
  };
}

function buildCustomCssKey(config: CustomCssConfig): string {
  return JSON.stringify({
    globalPath: config.globalPath ?? '',
    workspaceFolder: config.workspaceFolder?.uri.fsPath ?? '',
    workspacePath: config.workspacePath ?? ''
  });
}

async function readGlobalCustomCss(
  globalPath: string
): Promise<string | undefined> {
  if (
    !path.isAbsolute(globalPath) ||
    path.extname(globalPath).toLowerCase() !== '.css'
  ) {
    void vscode.window.showWarningMessage(
      'Ignoring global custom CSS path because it is not an absolute .css file.'
    );
    return undefined;
  }

  try {
    return await fs.readFile(globalPath, 'utf8');
  } catch {
    void vscode.window.showWarningMessage(
      `Could not read global custom CSS file: ${globalPath}`
    );
    return undefined;
  }
}

async function readWorkspaceCustomCss(
  config: CustomCssConfig
): Promise<string | undefined> {
  if (!config.workspacePath || !config.workspaceFolder) {
    return undefined;
  }

  const target = vscode.Uri.joinPath(
    config.workspaceFolder.uri,
    config.workspacePath
  );
  const relative = path.relative(
    config.workspaceFolder.uri.fsPath,
    target.fsPath
  );
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    path.extname(target.fsPath).toLowerCase() !== '.css'
  ) {
    void vscode.window.showWarningMessage(
      'Ignoring custom CSS path because it is not a workspace-local .css file.'
    );
    return undefined;
  }

  try {
    return await fs.readFile(target.fsPath, 'utf8');
  } catch {
    void vscode.window.showWarningMessage(
      `Could not read custom CSS file: ${config.workspacePath}`
    );
    return undefined;
  }
}

export function getCustomCssKey(documentUri: vscode.Uri): string {
  return buildCustomCssKey(getCustomCssConfig(documentUri));
}

export async function resolveCustomCss(
  documentUri: vscode.Uri
): Promise<ResolvedCustomCss> {
  const config = getCustomCssConfig(documentUri);
  const cssParts: string[] = [];

  if (config.globalPath) {
    const globalCss = await readGlobalCustomCss(config.globalPath);
    if (globalCss) {
      cssParts.push(globalCss);
    }
  }

  if (config.workspacePath) {
    const workspaceCss = await readWorkspaceCustomCss(config);
    if (workspaceCss) {
      cssParts.push(workspaceCss);
    }
  }

  return {
    cssText: cssParts.length > 0 ? cssParts.join('\n\n') : undefined,
    key: buildCustomCssKey(config)
  };
}

export async function confirmSanitizeDisabled(
  documentUri?: vscode.Uri
): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration(
    'offlineMarkdownViewer',
    documentUri
  );
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
