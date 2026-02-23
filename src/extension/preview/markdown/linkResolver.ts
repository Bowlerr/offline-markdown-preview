import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface ResolvedLink {
  kind: 'heading' | 'external' | 'workspace' | 'outside-workspace' | 'invalid';
  href: string;
  uri?: vscode.Uri;
  fragment?: string;
}

export function isHttpUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

export function normalizeFragment(fragment: string): string {
  return fragment.replace(/^#/, '').trim();
}

export function resolveLinkTarget(source: vscode.Uri, href: string): ResolvedLink {
  if (!href.trim()) {
    return { kind: 'invalid', href };
  }

  if (href.startsWith('#')) {
    return { kind: 'heading', href, fragment: normalizeFragment(href) };
  }

  if (isHttpUrl(href) || /^mailto:/i.test(href)) {
    return { kind: 'external', href, uri: vscode.Uri.parse(href, true) };
  }

  try {
    const [rawPath, fragment] = href.split('#');
    const candidate = rawPath
      ? vscode.Uri.joinPath(source.with({ path: path.posix.dirname(source.path) }), rawPath)
      : source;
    const folder = vscode.workspace.getWorkspaceFolder(source);
    if (!folder) {
      return { kind: 'outside-workspace', href, uri: candidate, fragment };
    }
    if (!isWithinWorkspace(candidate, folder.uri)) {
      return { kind: 'outside-workspace', href, uri: candidate, fragment };
    }
    return { kind: 'workspace', href, uri: candidate, fragment };
  } catch {
    return { kind: 'invalid', href };
  }
}

export function isWithinWorkspace(target: vscode.Uri, workspaceRoot: vscode.Uri): boolean {
  const targetPath = target.fsPath;
  const rootPath = workspaceRoot.fsPath;
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function fileSizeBytes(uri: vscode.Uri): Promise<number> {
  const stat = await fs.stat(uri.fsPath);
  return stat.size;
}

export async function toDataUri(uri: vscode.Uri): Promise<string> {
  const bytes = await fs.readFile(uri.fsPath);
  const ext = path.extname(uri.fsPath).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.svg'
            ? 'image/svg+xml'
            : 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export function resolveImageUri(source: vscode.Uri, src: string): vscode.Uri | undefined {
  if (!src || isHttpUrl(src) || /^data:/i.test(src) || /^vscode-webview-resource:/i.test(src)) {
    return undefined;
  }
  const sourceFolder = vscode.workspace.getWorkspaceFolder(source);
  if (/^file:/i.test(src)) {
    const parsed = vscode.Uri.parse(src, true);
    if (!sourceFolder) return parsed;
    return isWithinWorkspace(parsed, sourceFolder.uri) ? parsed : undefined;
  }
  const resolved = vscode.Uri.joinPath(source.with({ path: path.posix.dirname(source.path) }), src);
  if (!sourceFolder) return resolved;
  return isWithinWorkspace(resolved, sourceFolder.uri) ? resolved : undefined;
}
