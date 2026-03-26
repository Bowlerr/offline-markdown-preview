import * as path from 'node:path';

export class Uri {
  constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
    public readonly path: string,
    private readonly raw: string
  ) {}

  static file(fsPath: string): Uri {
    const normalized = fsPath.replace(/\\/g, '/');
    return new Uri('file', fsPath, normalized, `file://${normalized}`);
  }

  static parse(input: string): Uri {
    if (input.startsWith('file://')) {
      const p = input.slice('file://'.length);
      return Uri.file(p);
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

  with(update: { path?: string }): Uri {
    const nextPath = update.path ?? this.path;
    return Uri.file(nextPath);
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
    workspace: {
      workspaceFile: undefined,
      workspaceFolders,
      textDocuments: [],
      getWorkspaceFolder(uri: Uri) {
        return workspaceFolders.find((folder) => {
          const rel = path.relative(folder.uri.fsPath, uri.fsPath);
          return (
            rel === '' ||
            (!rel.startsWith('..') && !path.isAbsolute(rel))
          );
        });
      }
    }
  };
}
