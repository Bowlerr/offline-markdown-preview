import type * as vscode from 'vscode';

import { registerCommands } from './commands';
import { PreviewController } from './preview/PreviewPanel';

let controller: PreviewController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  controller = new PreviewController(context);
  context.subscriptions.push(controller);

  registerCommands(context, controller);
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
