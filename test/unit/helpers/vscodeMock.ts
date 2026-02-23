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
  return {
    Uri,
    workspace: {
      getWorkspaceFolder(uri: Uri) {
        if (!workspaceRoot) return undefined;
        const root = Uri.file(workspaceRoot);
        const rel = path.relative(root.fsPath, uri.fsPath);
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          return { uri: root };
        }
        return undefined;
      }
    }
  };
}
