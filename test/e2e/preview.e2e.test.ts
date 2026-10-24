import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from './vscodeFixture';
import { expectReadableFlowchart } from './diagramAssertions';

test(
  'limits very large search results and restores original content',
  { tag: '@stress' },
  async ({ vscode }) => {
    await writeFile(
      join(vscode.workspace, 'journey.md'),
      '# Stress\n\n```text\n' + 'a '.repeat(200_000) + '\n```\n'
    );
    const preview = await vscode.openMarkdown('journey.md');
    const code = preview.locator('pre code');
    const original = await code.textContent();
    await preview.getByRole('searchbox', { name: 'Search preview' }).fill('a');
    await expect(preview.locator('.omv-meta')).toHaveText(
      '1 of 1,000+ matches (first 1,000 shown)'
    );
    await expect(preview.locator('mark.omv-search-hit')).toHaveCount(1_000);
    expect(
      await preview.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            requestAnimationFrame(() => resolve(true));
          })
      )
    ).toBe(true);
    await preview.getByRole('button', { name: 'Clear search' }).click();
    await expect(preview.locator('mark.omv-search-hit')).toHaveCount(0);
    expect(
      await code.evaluate(
        (element, expected) => element.textContent === expected,
        original
      )
    ).toBe(true);
  }
);

test('renders local Markdown, Mermaid, math, and images without remote image requests', async ({
  vscode
}, testInfo) => {
  const remoteRequests: string[] = [];
  await vscode.app
    .context()
    .route('https://offline-preview-e2e.invalid/**', async (route) => {
      remoteRequests.push(route.request().url());
      await route.abort();
    });
  const preview = await vscode.openMarkdown('journey.md');
  await expect(preview.locator('h1')).toContainText('Release Journey');
  await expect(preview.locator('.katex')).toHaveCount(2);
  await expect(preview.locator('.omv-mermaid svg')).toBeVisible();
  await expectReadableFlowchart(preview.locator('.omv-mermaid'));
  const image = preview.getByAltText('Local test image');
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0);
  await expect(
    preview.getByRole('button', { name: 'Download Image', exact: true })
  ).toHaveCount(2);
  await expect(preview.locator('body')).not.toHaveAttribute(
    'data-unsafe',
    'executed'
  );
  await expect(
    preview.locator(
      '.omv-preview script, .omv-preview [onerror], .omv-preview a[href^="javascript:"]'
    )
  ).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
  await preview.locator('.omv-preview-scroll').evaluate((element) => {
    element.scrollTop = 0;
  });
  await vscode.page.screenshot({ path: testInfo.outputPath('preview.png') });
});

test('search crosses inline formatting and code spans with keyboard navigation', async ({
  vscode
}) => {
  const preview = await vscode.openMarkdown('journey.md');
  const search = preview.getByRole('searchbox', { name: 'Search preview' });
  const codeBefore = await preview.locator('pre code').innerHTML();
  await search.fill('cross format');
  await expect(preview.locator('.omv-meta')).toHaveText('1 of 3 matches');
  await search.press('Enter');
  await expect(preview.locator('.omv-meta')).toHaveText('2 of 3 matches');
  await search.press('Shift+Enter');
  await expect(preview.locator('.omv-meta')).toHaveText('1 of 3 matches');
  await search.fill('const searchableCode');
  await expect(preview.locator('.omv-meta')).toHaveText('1 of 1 matches');
  await expect(preview.locator('mark mark')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Clear search' }).click();
  await expect(preview.locator('pre code')).toHaveJSProperty(
    'innerHTML',
    codeBefore
  );
  await expect(preview.locator('mark.omv-search-hit')).toHaveCount(0);
  await search.fill('no matching phrase');
  await expect(preview.locator('.omv-meta')).toContainText(/no matches/i);
  await expect(preview.locator('[data-action="next"]')).toBeDisabled();
  await search.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        isComposing: true
      })
    )
  );
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(search).toBeHidden();
  await expect(preview.locator('[data-ui-toggle="search"]')).toBeFocused();
});

test('live edits update the active preview and preserve scroll position', async ({
  vscode
}) => {
  const source = join(vscode.workspace, 'journey.md');
  const original = await readFile(source, 'utf8');
  await writeFile(
    source,
    original +
      '\n' +
      Array.from(
        { length: 80 },
        (_, i) => `## Section ${i}\n\nLong document paragraph ${i}.\n`
      ).join('\n')
  );
  const preview = await vscode.openMarkdown('journey.md');
  const heading = preview.locator(
    '.omv-toc button[data-heading-id="section-20"]'
  );
  await heading.focus();
  await heading.press('Enter');
  await expect(heading).toBeFocused();
  const scroller = preview.locator('.omv-preview-scroll');
  await scroller.evaluate((element) => {
    element.scrollTop = 1400;
  });
  const before = await scroller.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(1000);
  await writeFile(
    source,
    (await readFile(source, 'utf8')).replace(
      'Long document paragraph 79.',
      'Updated live document paragraph.'
    )
  );
  await expect(preview.locator('.omv-preview')).toContainText(
    'Updated live document paragraph.'
  );
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before - 100);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeLessThan(before + 100);
});

test('diagram controls support named buttons and keyboard panning', async ({
  vscode
}) => {
  const preview = await vscode.openMarkdown('journey.md');
  const viewport = preview.getByRole('group', {
    name: /^Mermaid diagram viewer\./
  });
  await viewport.scrollIntoViewIfNeeded();
  await expect(
    preview.getByRole('button', { name: 'Zoom in', exact: true })
  ).toBeVisible();
  await expect(
    preview.getByRole('button', { name: 'Zoom out', exact: true })
  ).toBeVisible();
  await preview
    .getByRole('button', { name: 'Reset diagram to 100% size', exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await preview.getByRole('button', { name: 'Zoom in', exact: true }).click();
  }
  const canvas = preview.locator('.omv-mermaid-canvas');
  const scale = () =>
    canvas.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a
    );
  await expect.poll(scale).toBeGreaterThan(1);
  const original = await canvas.getAttribute('style');
  await viewport.focus();
  await viewport.press('ArrowRight');
  await expect(viewport).toBeFocused();
  await expect(canvas).not.toHaveAttribute('style', original ?? '');
  const afterKeyboardPan = await canvas.getAttribute('style');
  await preview.getByRole('button', { name: 'Pan left', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('style', afterKeyboardPan ?? '');
  await preview
    .getByRole('button', { name: 'Reset diagram to 100% size', exact: true })
    .click();
  await expect.poll(scale).toBe(1);
  await preview.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(scale).toBeGreaterThan(1);
  await preview
    .getByRole('button', { name: 'Fit diagram to viewport', exact: true })
    .click();
  await expect.poll(scale).toBeLessThanOrEqual(1);
  await expect(preview.locator('.omv-mermaid svg')).toBeVisible();
});

test('renders flowchart mathematics, sequence diagrams, and class diagrams', async ({
  vscode
}) => {
  const preview = await vscode.openMarkdown('diagrams.md');
  await expect(preview.locator('.omv-mermaid svg')).toHaveCount(3);
  await expect(preview.locator('.omv-mermaid-error')).toHaveCount(0);
  await expect(
    preview.locator('.omv-mermaid').first().locator('.katex')
  ).toHaveCount(1);
  // A live theme update must settle instead of repeatedly triggering its own
  // class MutationObserver and starving rendering/the browser event loop.
  const heartbeat = await preview.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document.body.className = 'vscode-body vscode-light';
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      })
  );
  expect(heartbeat).toBe(true);
  await expect(preview.locator('.omv-mermaid svg')).toHaveCount(3);
  await expect(preview.locator('.omv-mermaid-error')).toHaveCount(0);
});
