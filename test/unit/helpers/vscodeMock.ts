import * as path from 'node:path';

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
    const normalized = fsPath.replace(/\\/g, '/');
    return new Uri('file', fsPath, normalized, `file://${normalized}`);
  }

  static parse(input: string): Uri {
    if (input.startsWith('file://')) {
      const match = /^file:\/\/([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(input);
      const normalizedPath = (match?.[1] ?? '').replace(/\\/g, '/');
      const fsPath = normalizedPath;
      const query = match?.[2] ?? '';
      const fragment = match?.[3] ?? '';
      return new Uri('file', fsPath, normalizedPath, input, query, fragment);
    }
    if (/^https?:\/\//i.test(input)) {
      return new Uri(input.split(':')[0], '', '', input);
    }
    return Uri.file(input);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const nextPath = path.resolve(base.fsPath || base.path || '/', ...segments);
    return Uri.file(nextPath);
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
      nextPath,
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
    name: path.basename(rootPath),
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
