import * as path from 'node:path';

const posixPath = path.posix;

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(normalizeSlashes(value));
}

function toUriPath(fsPath: string): string {
  const normalized = normalizeSlashes(fsPath);
  if (isWindowsDrivePath(normalized)) {
    return `/${normalized}`;
  }
  return normalized;
}

function toFsPath(uriPath: string): string {
  return /^\/[A-Za-z]:\//.test(uriPath) ? uriPath.slice(1) : uriPath;
}

export class Uri {
  constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
    public readonly path: string,
    private readonly raw: string,
    public readonly query = '',
    public readonly fragment = ''
  ) {}

  static file(fsPath: string): Uri {
    const normalizedFsPath = normalizeSlashes(fsPath);
    const uriPath = toUriPath(normalizedFsPath);
    return new Uri('file', normalizedFsPath, uriPath, `file://${uriPath}`);
  }

  static parse(input: string): Uri {
    if (input.startsWith('file://')) {
      const match = /^file:\/\/([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(input);
      const uriPath = normalizeSlashes(match?.[1] ?? '');
      const fsPath = toFsPath(uriPath);
      const query = match?.[2] ?? '';
      const fragment = match?.[3] ?? '';
      return new Uri('file', fsPath, uriPath, input, query, fragment);
    }
    if (/^https?:\/\//i.test(input)) {
      return new Uri(input.split(':')[0], '', '', input);
    }
    return Uri.file(input);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const nextUriPath = posixPath.resolve(base.path || '/', ...segments);
    return new Uri(
      'file',
      toFsPath(nextUriPath),
      nextUriPath,
      `file://${nextUriPath}`
    );
  }

  with(update: { path?: string; query?: string; fragment?: string }): Uri {
    const nextPath = update.path ?? this.path;
    const base =
      this.scheme === 'file'
        ? `file://${nextPath}`
        : `${this.scheme}:${nextPath}`;
    const nextQuery = update.query ?? this.query;
    const nextFragment = update.fragment ?? this.fragment;
    const nextRaw =
      `${base}${nextQuery ? `?${nextQuery}` : ''}` +
      `${nextFragment ? `#${nextFragment}` : ''}`;
    return new Uri(
      this.scheme,
      this.scheme === 'file' ? toFsPath(nextPath) : nextPath,
      nextPath,
      nextRaw,
      nextQuery,
      nextFragment
    );
  }

  toString(): string {
    return this.raw;
  }
}

export function createVscodeMock(workspaceRoot?: string) {
  const workspaceFolderPaths = workspaceRoot ? [workspaceRoot] : [];
  const workspaceFolders = workspaceFolderPaths.map((rootPath) => ({
    name: path.basename(normalizeSlashes(rootPath)),
    uri: Uri.file(rootPath)
  }));

  return {
    Uri,
    extensions: {
      getExtension() {
        return undefined;
      }
    },
    workspace: {
      workspaceFile: undefined,
      workspaceFolders,
      textDocuments: [],
      getWorkspaceFolder(uri: Uri) {
        return workspaceFolders.find((folder) => {
          const rel = path.relative(folder.uri.fsPath, uri.fsPath);
          return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        });
      }
    }
  };
}
