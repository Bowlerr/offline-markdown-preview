import type * as vscode from 'vscode';

export interface TocItem {
  id: string;
  level: number;
  text: string;
  line: number;
}

export interface FrontmatterInfo {
  raw: string;
  data: Record<string, unknown>;
}

export interface PreviewSettingsPayload {
  enableMermaid: boolean;
  enableMath: boolean;
  scrollSync: boolean;
  sanitizeHtml: boolean;
  showFrontmatter: boolean;
}

export interface RenderPayload {
  type: 'render';
  requestId: number;
  documentUri: string;
  version: number;
  html: string;
  toc: TocItem[];
  frontmatter?: FrontmatterInfo;
  editorLineCount: number;
  settings: PreviewSettingsPayload;
}

export interface EditorScrollPayload {
  type: 'editorScroll';
  percent: number;
  line?: number;
  source: 'extension';
}

export interface NotifyPayload {
  type: 'notify';
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface SearchCommandPayload {
  type: 'searchCommand';
  action: 'open' | 'next' | 'prev' | 'clear';
}

export interface ExportPdfPayload {
  type: 'exportPdf';
}

export interface RequestHtmlExportSnapshotPayload {
  type: 'requestHtmlExportSnapshot';
  requestId: number;
}

export type ExtensionToWebviewMessage =
  | RenderPayload
  | EditorScrollPayload
  | NotifyPayload
  | SearchCommandPayload
  | ExportPdfPayload
  | RequestHtmlExportSnapshotPayload;

export interface WebviewReadyMessage {
  type: 'ready';
}

export interface PreviewScrollMessage {
  type: 'previewScroll';
  percent: number;
  line?: number;
}

export interface OpenLinkMessage {
  type: 'openLink';
  href: string;
  kindHint?: 'heading' | 'external' | 'relative' | 'unknown';
}

export interface HeadingSelectedMessage {
  type: 'headingSelected';
  headingId: string;
}

export interface CopyHeadingLinkMessage {
  type: 'copyHeadingLink';
  headingId: string;
}

export interface SearchRequestMessage {
  type: 'search';
  action: 'query' | 'next' | 'prev' | 'clear';
  query?: string;
}

export interface PdfExportResultMessage {
  type: 'pdfExportResult';
  ok: boolean;
  error?: string;
}

export interface OpenImageMessage {
  type: 'openImage';
  src: string;
}

export interface RequestExportMessage {
  type: 'requestExport';
}

export interface HtmlExportSnapshotMessage {
  type: 'htmlExportSnapshot';
  requestId: number;
  html: string;
}

export type WebviewToExtensionMessage =
  | WebviewReadyMessage
  | PreviewScrollMessage
  | OpenLinkMessage
  | HeadingSelectedMessage
  | CopyHeadingLinkMessage
  | SearchRequestMessage
  | PdfExportResultMessage
  | OpenImageMessage
  | RequestExportMessage
  | HtmlExportSnapshotMessage;

export interface RenderedDocumentSnapshot {
  uri: vscode.Uri;
  version: number;
  html: string;
  toc: TocItem[];
  frontmatter?: FrontmatterInfo;
  lineCount: number;
}
