import * as fs from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { GitHubMarkdownStylePayload } from '../../messaging/protocol';

export interface ResolvedCustomCss {
  cssTexts: string[];
  key: string;
}

type CustomCssScope = 'workspace' | 'workspaceFolder';

interface CustomCssConfig {
  globalPath?: string;
  workspacePath?: string;
  workspaceScope?: CustomCssScope;
  workspaceBaseUri?: vscode.Uri;
  workspaceFolder?: vscode.WorkspaceFolder;
  useMarkdownPreviewGithubStyling: boolean;
}

interface ContributedMarkdownStyleExtension {
  extensionUri: vscode.Uri;
  packageJSON?: {
    contributes?: {
      'markdown.previewStyles'?: unknown;
    };
  };
}

const githubThemeModes = ['auto', 'system', 'light', 'dark'] as const;
const githubThemeNames = [
  'light',
  'light_high_contrast',
  'light_colorblind',
  'light_tritanopia',
  'dark',
  'dark_high_contrast',
  'dark_colorblind',
  'dark_tritanopia',
  'dark_dimmed'
] as const;

type GitHubThemeMode = (typeof githubThemeModes)[number];
type GitHubThemeName = (typeof githubThemeNames)[number];

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

export function getWorkspaceCustomCssBaseUri(): vscode.Uri | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === 'file') {
    return vscode.Uri.file(path.dirname(workspaceFile.fsPath));
  }

  if ((vscode.workspace.workspaceFolders?.length ?? 0) === 1) {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  return undefined;
}

function isUriWithinFolder(
  target: vscode.Uri,
  folder: vscode.WorkspaceFolder
): boolean {
  const relative = path.relative(folder.uri.fsPath, target.fsPath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function isUriWithinWorkspace(target: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some((folder) =>
    isUriWithinFolder(target, folder)
  );
}

function getCustomCssConfig(documentUri: vscode.Uri): CustomCssConfig {
  const cfg = vscode.workspace.getConfiguration(
    'offlineMarkdownViewer',
    documentUri
  );
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  const customCssInspect = cfg.inspect<string>('preview.customCssPath');
  const rawWorkspaceFolderPath = customCssInspect?.workspaceFolderValue;
  const rawWorkspacePath = customCssInspect?.workspaceValue;
  const workspaceFolderPath = normalizeConfiguredPath(rawWorkspaceFolderPath);
  const workspacePath = normalizeConfiguredPath(rawWorkspacePath);
  const hasWorkspaceFolderOverride = rawWorkspaceFolderPath !== undefined;

  return {
    globalPath: normalizeConfiguredPath(
      cfg.inspect<string>('preview.globalCustomCssPath')?.globalValue
    ),
    workspacePath: hasWorkspaceFolderOverride
      ? workspaceFolderPath
      : workspacePath,
    workspaceScope: hasWorkspaceFolderOverride
      ? 'workspaceFolder'
      : workspacePath
        ? 'workspace'
        : undefined,
    workspaceBaseUri: hasWorkspaceFolderOverride
      ? workspaceFolder?.uri
      : workspacePath
        ? getWorkspaceCustomCssBaseUri()
        : undefined,
    workspaceFolder,
    useMarkdownPreviewGithubStyling: cfg.get<boolean>(
      'preview.useMarkdownPreviewGithubStyling',
      false
    )
  };
}

function buildCustomCssKey(config: CustomCssConfig): string {
  return JSON.stringify({
    globalPath: config.globalPath ?? '',
    useMarkdownPreviewGithubStyling: config.useMarkdownPreviewGithubStyling,
    workspaceBase: config.workspaceBaseUri?.fsPath ?? '',
    workspaceFolder: config.workspaceFolder?.uri.fsPath ?? '',
    workspaceScope: config.workspaceScope ?? '',
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

function isGithubThemeMode(value: unknown): value is GitHubThemeMode {
  return githubThemeModes.includes(value as GitHubThemeMode);
}

function isGithubThemeName(value: unknown): value is GitHubThemeName {
  return githubThemeNames.includes(value as GitHubThemeName);
}

export function getGithubMarkdownStyleSettings(
  enabled: boolean
): GitHubMarkdownStylePayload {
  const settings = vscode.workspace.getConfiguration(
    'markdown-preview-github-styles',
    null
  );
  const colorModeSetting = settings.get<string>('colorTheme');
  const lightThemeSetting = settings.get<string>('lightTheme');
  const darkThemeSetting = settings.get<string>('darkTheme');

  return {
    enabled,
    colorMode: isGithubThemeMode(colorModeSetting) ? colorModeSetting : 'auto',
    lightTheme: isGithubThemeName(lightThemeSetting)
      ? lightThemeSetting
      : 'light',
    darkTheme: isGithubThemeName(darkThemeSetting) ? darkThemeSetting : 'dark'
  };
}

function getGithubMarkdownStyleExtension():
  | ContributedMarkdownStyleExtension
  | undefined {
  const extension = vscode.extensions.getExtension<
    ContributedMarkdownStyleExtension['packageJSON']
  >('bierner.markdown-preview-github-styles');
  if (!extension) {
    return undefined;
  }

  return extension as unknown as ContributedMarkdownStyleExtension;
}

function getGithubMarkdownStyleUris(): vscode.Uri[] {
  const extension = getGithubMarkdownStyleExtension();
  if (!extension) {
    return [];
  }

  const previewStyles =
    extension.packageJSON?.contributes?.['markdown.previewStyles'];
  if (!Array.isArray(previewStyles)) {
    return [];
  }

  const uris: vscode.Uri[] = [];
  for (const stylePath of previewStyles) {
    if (typeof stylePath !== 'string' || !stylePath.trim()) {
      continue;
    }

    const target = vscode.Uri.joinPath(extension.extensionUri, stylePath);
    if (path.extname(target.fsPath).toLowerCase() !== '.css') {
      continue;
    }

    uris.push(target);
  }

  return uris;
}

async function readGithubMarkdownPreviewStyles(
  enabled: boolean
): Promise<string[]> {
  if (!enabled) {
    return [];
  }

  const extension = getGithubMarkdownStyleExtension();
  if (!extension) {
    void vscode.window.showWarningMessage(
      'GitHub Markdown styling is enabled, but bierner.markdown-preview-github-styles is not installed.'
    );
    return [];
  }

  const cssTexts: string[] = [];
  let hadReadError = false;
  for (const target of getGithubMarkdownStyleUris()) {
    const openDocumentText = getOpenDocumentText(target);
    if (openDocumentText !== undefined) {
      cssTexts.push(openDocumentText);
      continue;
    }

    try {
      cssTexts.push(await fs.readFile(target.fsPath, 'utf8'));
    } catch {
      hadReadError = true;
    }
  }

  if (hadReadError) {
    void vscode.window.showWarningMessage(
      'Could not read one or more CSS files from bierner.markdown-preview-github-styles.'
    );
  }

  return cssTexts;
}

function getGlobalCustomCssUri(
  globalPath: string | undefined
): vscode.Uri | undefined {
  if (
    !globalPath ||
    !path.isAbsolute(globalPath) ||
    path.extname(globalPath).toLowerCase() !== '.css'
  ) {
    return undefined;
  }
  return vscode.Uri.file(globalPath);
}

function getWorkspaceCustomCssUris(config: CustomCssConfig): vscode.Uri[] {
  if (!config.workspacePath || !config.workspaceScope) {
    return [];
  }

  const candidateBases: Array<{
    baseUri: vscode.Uri;
    mode: 'workspace' | 'workspaceFolder';
  }> = [];
  if (config.workspaceScope === 'workspace' && config.workspaceBaseUri) {
    candidateBases.push({
      baseUri: config.workspaceBaseUri,
      mode: 'workspace'
    });
  }
  if (config.workspaceFolder) {
    candidateBases.push({
      baseUri: config.workspaceFolder.uri,
      mode: 'workspaceFolder'
    });
  }

  const seen = new Set<string>();
  const targets: vscode.Uri[] = [];
  for (const candidate of candidateBases) {
    const target = vscode.Uri.joinPath(candidate.baseUri, config.workspacePath);
    if (path.extname(target.fsPath).toLowerCase() !== '.css') {
      continue;
    }

    const isAllowed =
      candidate.mode === 'workspace'
        ? isUriWithinWorkspace(target)
        : config.workspaceFolder
          ? isUriWithinFolder(target, config.workspaceFolder)
          : false;
    if (!isAllowed) {
      continue;
    }

    const key = target.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(target);
  }

  return targets;
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

  const targets = getWorkspaceCustomCssUris(config);
  if (targets.length === 0) {
    void vscode.window.showWarningMessage(
      'Ignoring custom CSS path because it is not a workspace-local .css file.'
    );
    return undefined;
  }

  for (const target of targets) {
    const openDocumentText = getOpenDocumentText(target);
    if (openDocumentText !== undefined) {
      return openDocumentText;
    }

    try {
      return await fs.readFile(target.fsPath, 'utf8');
    } catch {
      // Try the next compatible location before warning.
    }
  }

  void vscode.window.showWarningMessage(
    `Could not read custom CSS file: ${config.workspacePath}`
  );
  return undefined;
}

export function getConfiguredCustomCssUris(
  documentUri: vscode.Uri
): vscode.Uri[] {
  const config = getCustomCssConfig(documentUri);
  const targets = [
    getGlobalCustomCssUri(config.globalPath),
    ...getWorkspaceCustomCssUris(config)
  ].filter((target): target is vscode.Uri => Boolean(target));
  return targets;
}

export async function resolveCustomCss(
  documentUri: vscode.Uri
): Promise<ResolvedCustomCss> {
  const config = getCustomCssConfig(documentUri);
  const cssTexts: string[] = [];
  let githubStyleHash = '';
  let globalHash = '';
  let workspaceHash = '';

  if (config.useMarkdownPreviewGithubStyling) {
    const githubCssTexts = await readGithubMarkdownPreviewStyles(
      config.useMarkdownPreviewGithubStyling
    );
    if (githubCssTexts.length > 0) {
      cssTexts.push(...githubCssTexts);
      githubStyleHash = githubCssTexts.map(hashCssText).join(':');
    }
  }

  if (config.globalPath) {
    const globalCss = await readGlobalCustomCss(config.globalPath);
    if (globalCss) {
      cssTexts.push(globalCss);
      globalHash = hashCssText(globalCss);
    }
  }

  if (config.workspacePath) {
    const workspaceCss = await readWorkspaceCustomCss(config);
    if (workspaceCss) {
      cssTexts.push(workspaceCss);
      workspaceHash = hashCssText(workspaceCss);
    }
  }

  return {
    cssTexts,
    key: JSON.stringify({
      config: buildCustomCssKey(config),
      githubStyleHash,
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
