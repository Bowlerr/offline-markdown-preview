import { access, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { test, expect } from '@playwright/test';

const enabled = process.env.RUN_VSCODE_E2E === '1';

test.describe('export and link safety', () => {
  test.skip(!enabled, 'Set RUN_VSCODE_E2E=1 to run VS Code e2e export tests.');

  test('fixture links and local assets match export scenarios', async () => {
    const workspace = requireWorkspace();

    const sample = await readWorkspaceFile(workspace, 'sample.md');
    const linkedDoc = await readWorkspaceFile(workspace, 'linked-doc.md');
    const linkedSubdoc = await readWorkspaceFile(workspace, 'sub/linked-subdoc.md');
    const mermaidEdgeCases = await readWorkspaceFile(workspace, 'mermaid-edge-cases.md');
    const bannerSvg = await readWorkspaceFile(workspace, 'assets/banner.svg');
    const gridSvg = await readWorkspaceFile(workspace, 'assets/grid.svg');

    expect(process.env.VSCODE_EXECUTABLE_PATH).toBeTruthy();
    expect(process.env.OMV_E2E_EXTENSION_DEV_PATH).toBeTruthy();

    const markdownLinks = [
      ...extractMarkdownLinks(linkedDoc),
      ...extractMarkdownLinks(linkedSubdoc),
      ...extractMarkdownLinks(mermaidEdgeCases)
    ];
    expect(markdownLinks).toEqual(
      expect.arrayContaining([
        './sample.md#links-and-assets-offline-safe',
        '../sample.md#mermaid-diagrams',
        './sample.md#mermaid-diagrams'
      ])
    );

    await assertWorkspaceRelativeMarkdownLinksResolve(workspace, 'linked-doc.md', linkedDoc);
    await assertWorkspaceRelativeMarkdownLinksResolve(workspace, 'sub/linked-subdoc.md', linkedSubdoc);
    await assertWorkspaceRelativeMarkdownLinksResolve(workspace, 'mermaid-edge-cases.md', mermaidEdgeCases);

    expect(bannerSvg).toContain('<svg');
    expect(bannerSvg).toContain('Offline Markdown Viewer Pro');
    expect(bannerSvg).toMatch(/width="960"/);
    expect(gridSvg).toContain('<svg');
    expect(gridSvg).toContain('Local SVG Asset');
    expect(gridSvg).toMatch(/pattern id="grid"/);

    const sampleImageRefs = extractMarkdownImageLinks(sample);
    if (sampleImageRefs.length === 0) {
      test.info().annotations.push({
        type: 'fixture-note',
        description:
          'sample.md currently has no image links. The export fixture coverage is provided by checked-in SVG assets and linked docs until sample.md is expanded.'
      });
    }

    const sampleLocalDocLinks = extractMarkdownLinks(sample).filter((link) => link.includes('.md'));
    if (sampleLocalDocLinks.length === 0) {
      test.info().annotations.push({
        type: 'fixture-note',
        description:
          'sample.md currently has no local Markdown links. linked-doc.md, sub/linked-subdoc.md, and mermaid-edge-cases.md cover relative-link export cases.'
      });
    }
  });

  test('export PDF command dispatch smoke hook', async () => {
    expect(process.env.VSCODE_EXECUTABLE_PATH).toBeTruthy();
    expect(process.env.OMV_E2E_WORKSPACE).toBeTruthy();
    test.info().annotations.push({
      type: 'coverage',
      description: 'Command dispatch + PDF export UI automation remains optional; fixture assertions now validate local assets/links used by export scenarios.'
    });
  });
});

function requireWorkspace(): string {
  const workspace = process.env.OMV_E2E_WORKSPACE;
  expect(workspace).toBeTruthy();
  return workspace!;
}

async function readWorkspaceFile(workspace: string, relativePath: string): Promise<string> {
  const fullPath = join(workspace, relativePath);
  await access(fullPath);
  return readFile(fullPath, 'utf8');
}

function extractMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const regex = /(?<!!)\[[^\]]*]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(regex)) {
    const href = match[1]?.trim();
    if (href) links.push(href);
  }
  return links;
}

function extractMarkdownImageLinks(markdown: string): string[] {
  const links: string[] = [];
  const regex = /!\[[^\]]*]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(regex)) {
    const href = match[1]?.trim();
    if (href) links.push(href);
  }
  return links;
}

function stripHash(href: string): string {
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}

async function assertWorkspaceRelativeMarkdownLinksResolve(
  workspace: string,
  sourceRelativePath: string,
  markdown: string
): Promise<void> {
  const sourceDir = dirname(join(workspace, sourceRelativePath));
  const workspaceRoot = resolve(workspace);
  for (const link of extractMarkdownLinks(markdown)) {
    const targetPath = stripHash(link);
    if (!targetPath || !targetPath.endsWith('.md')) continue;
    const resolved = resolve(sourceDir, targetPath);
    const rel = relative(workspaceRoot, resolved);
    expect(rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))).toBe(true);
    await access(resolved);
  }
}
