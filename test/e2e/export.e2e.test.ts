import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { expect, test, waitForFile } from './vscodeFixture';

test('exports the actual rendered preview to a standalone HTML file', async ({
  vscode,
  browser
}, testInfo) => {
  const preview = await vscode.openMarkdown('journey.md');
  await expect(preview.locator('.omv-mermaid svg')).toBeVisible();
  await expect(preview.locator('.katex')).toHaveCount(2);
  await preview.getByRole('button', { name: 'Export', exact: true }).click();
  await vscode.page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Self-contained HTML export' })
    .click();
  const saveInput = vscode.page.locator(
    '.quick-input-widget input[type="text"]'
  );
  await expect(saveInput).toBeVisible();
  const target = join(vscode.workspace, 'journey.html');
  await saveInput.fill(target);
  await saveInput.press('Enter');
  const html = (await waitForFile(target)).toString('utf8');
  expect(html).toContain('Release Journey');
  expect(html).toContain('katex');
  expect(html).toContain('<svg');
  expect(html).not.toContain('vscode-webview://');
  expect(html).not.toContain('vscode-resource.');
  expect(html).not.toContain('class="omv-chrome"');
  expect(html).not.toContain('onerror=');

  // Open the saved file in a real browser: source-string assertions alone
  // cannot prove that standalone CSS, rendered diagrams, fonts, and local assets work.
  const exportedPage = await browser.newPage();
  await exportedPage.goto(pathToFileURL(target).href);
  await expect(exportedPage.locator('h1')).toContainText('Release Journey');
  await expect(exportedPage.locator('.katex')).toHaveCount(2);
  await expect(exportedPage.locator('svg')).toBeVisible();
  const image = exportedPage.getByAltText('Local test image');
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0);
  await exportedPage.screenshot({
    path: testInfo.outputPath('exported-html.png')
  });
  await writeFile(testInfo.outputPath('exported.html'), html);
  await testInfo.attach('exported-html', {
    body: html,
    contentType: 'text/html'
  });
  await exportedPage.close();
});

test('exports a PDF from a cold preview through the real command and Chromium renderer', async ({
  vscode
}, testInfo) => {
  await vscode.openDocument('journey.md');
  await vscode.command('Offline Markdown Preview: Export PDF');
  const saveInput = vscode.page.locator(
    '.quick-input-widget input[type="text"]'
  );
  await expect(saveInput).toBeVisible();
  const target = join(vscode.workspace, 'journey.pdf');
  await saveInput.fill(target);
  await saveInput.press('Enter');
  const pdf = await waitForFile(target);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(5000);
  expect(pdf.subarray(-1024).toString()).toContain('%%EOF');
  await writeFile(testInfo.outputPath('exported.pdf'), pdf);
  await testInfo.attach('exported-pdf', {
    body: pdf,
    contentType: 'application/pdf'
  });
});
