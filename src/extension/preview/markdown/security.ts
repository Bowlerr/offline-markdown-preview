import * as fs from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
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

function hashCssText(cssText: string): string {
  return createHash('sha256').update(cssText).digest('hex');
}

function getOpenDocumentText(uri: vscode.Uri): string | undefined {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString()
  );
  return openDocument?.getText();
}

function getGlobalCustomCssUri(globalPath: string | undefined): vscode.Uri | undefined {
  if (
    !globalPath ||
    !path.isAbsolute(globalPath) ||
    path.extname(globalPath).toLowerCase() !== '.css'
  ) {
    return undefined;
  }
  return vscode.Uri.file(globalPath);
}

function getWorkspaceCustomCssUri(
  config: CustomCssConfig
): vscode.Uri | undefined {
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
    return undefined;
  }

  return target;
}

async function readGlobalCustomCss(
  globalPath: string
): Promise<string | undefined> {
  const target = getGlobalCustomCssUri(globalPath);
  if (!target) {
    void vscode.window.showWarningMessage(
      'Ignoring global custom CSS path because it is not an absolute .css file.'
    );
    return undefined;
  }

  const openDocumentText = getOpenDocumentText(target);
  if (openDocumentText !== undefined) {
    return openDocumentText;
  }

  try {
    return await fs.readFile(target.fsPath, 'utf8');
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

  const target = getWorkspaceCustomCssUri(config);
  if (!target) {
    void vscode.window.showWarningMessage(
      'Ignoring custom CSS path because it is not a workspace-local .css file.'
    );
    return undefined;
  }

  const openDocumentText = getOpenDocumentText(target);
  if (openDocumentText !== undefined) {
    return openDocumentText;
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

export function getConfiguredCustomCssUris(
  documentUri: vscode.Uri
): vscode.Uri[] {
  const config = getCustomCssConfig(documentUri);
  const targets = [
    getGlobalCustomCssUri(config.globalPath),
    getWorkspaceCustomCssUri(config)
  ].filter((target): target is vscode.Uri => Boolean(target));
  return targets;
}

export async function resolveCustomCss(
  documentUri: vscode.Uri
): Promise<ResolvedCustomCss> {
  const config = getCustomCssConfig(documentUri);
  const cssParts: string[] = [];
  let globalHash = '';
  let workspaceHash = '';

  if (config.globalPath) {
    const globalCss = await readGlobalCustomCss(config.globalPath);
    if (globalCss) {
      cssParts.push(globalCss);
      globalHash = hashCssText(globalCss);
    }
  }

  if (config.workspacePath) {
    const workspaceCss = await readWorkspaceCustomCss(config);
    if (workspaceCss) {
      cssParts.push(workspaceCss);
      workspaceHash = hashCssText(workspaceCss);
    }
  }

  return {
    cssText: cssParts.length > 0 ? cssParts.join('\n\n') : undefined,
    key: JSON.stringify({
      config: buildCustomCssKey(config),
      globalHash,
      workspaceHash
    })
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

export function inlineCssTag(
  cssText: string,
  nonce: string,
  attributes = ''
): string {
  const safeCss = cssText.replace(/<\/style/gi, '<\\/style');
  return `<style nonce="${nonce}"${attributes}>\n${safeCss}\n</style>`;
}
