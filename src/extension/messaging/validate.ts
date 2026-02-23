import { z } from 'zod';

import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from './protocol';

const numberPercent = z.number().min(0).max(1);

const webviewSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('previewScroll'), percent: numberPercent, line: z.number().int().min(0).optional() }),
  z.object({
    type: z.literal('openLink'),
    href: z.string().min(1),
    kindHint: z.enum(['heading', 'external', 'relative', 'unknown']).optional()
  }),
  z.object({ type: z.literal('headingSelected'), headingId: z.string().min(1) }),
  z.object({ type: z.literal('copyHeadingLink'), headingId: z.string().min(1) }),
  z.object({
    type: z.literal('search'),
    action: z.enum(['query', 'next', 'prev', 'clear']),
    query: z.string().optional()
  }),
  z.object({
    type: z.literal('pdfExportResult'),
    ok: z.boolean(),
    error: z.string().optional()
  }),
  z.object({ type: z.literal('openImage'), src: z.string().min(1) }),
  z.object({ type: z.literal('requestExport') }),
  z.object({
    type: z.literal('htmlExportSnapshot'),
    requestId: z.number().int().nonnegative(),
    html: z.string()
  })
]);

const extSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('render'),
    requestId: z.number().int().nonnegative(),
    documentUri: z.string().min(1),
    version: z.number().int().nonnegative(),
    html: z.string(),
    toc: z.array(
      z.object({
        id: z.string(),
        level: z.number().int().min(1).max(6),
        text: z.string(),
        line: z.number().int().min(0)
      })
    ),
    frontmatter: z
      .object({ raw: z.string(), data: z.record(z.unknown()) })
      .optional(),
    editorLineCount: z.number().int().min(1),
    settings: z.object({
      enableMermaid: z.boolean(),
      enableMath: z.boolean(),
      scrollSync: z.boolean(),
      sanitizeHtml: z.boolean(),
      showFrontmatter: z.boolean()
    })
  }),
  z.object({
    type: z.literal('editorScroll'),
    percent: numberPercent,
    line: z.number().int().min(0).optional(),
    source: z.literal('extension')
  }),
  z.object({ type: z.literal('notify'), level: z.enum(['info', 'warning', 'error']), message: z.string() }),
  z.object({ type: z.literal('searchCommand'), action: z.enum(['open', 'next', 'prev', 'clear']) }),
  z.object({ type: z.literal('exportPdf') }),
  z.object({
    type: z.literal('requestHtmlExportSnapshot'),
    requestId: z.number().int().nonnegative()
  })
]);

export function parseWebviewMessage(value: unknown): WebviewToExtensionMessage {
  return webviewSchema.parse(value) as WebviewToExtensionMessage;
}

export function parseExtensionMessage(value: unknown): ExtensionToWebviewMessage {
  return extSchema.parse(value) as ExtensionToWebviewMessage;
}
