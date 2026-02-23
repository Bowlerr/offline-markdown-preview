import * as vscode from 'vscode';

import type { TocItem } from './messaging/protocol';
import type { PreviewController } from './preview/PreviewPanel';

export function registerCommands(
  context: vscode.ExtensionContext,
  controller: PreviewController
): vscode.Disposable[] {
  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    ['offlineMarkdownViewer.openPreview', () => controller.openPreview(false)],
    ['offlineMarkdownViewer.openPreviewToSide', () => controller.openPreview(true)],
    ['offlineMarkdownViewer.exportHtml', () => controller.exportHtml()],
    ['offlineMarkdownViewer.exportPdf', () => controller.exportPdf()],
    ['offlineMarkdownViewer.toggleScrollSync', () => controller.toggleScrollSync()],
    ['offlineMarkdownViewer.copyHeadingLink', (item?: TocItem) => controller.copyHeadingLink(item)],
    ['offlineMarkdownViewer.revealHeading', (item: TocItem) => controller.revealHeadingItem(item)],
    ['offlineMarkdownViewer.quickPickHeading', () => controller.quickPickHeading()]
  ];

  return commands.map(([id, handler]) => {
    const disposable = vscode.commands.registerCommand(id, handler);
    context.subscriptions.push(disposable);
    return disposable;
  });
}
