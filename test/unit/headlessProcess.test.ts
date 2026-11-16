import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runHeadlessProcess } from '../../src/extension/preview/headlessProcess';

const directories: string[] = [];
const controllers: AbortController[] = [];
const escapedChildren: number[] = [];

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort();
  for (const pid of escapedChildren.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'omv-process-'));
  directories.push(directory);
  return directory;
}

const heartbeat = String.raw`
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = process.argv[1];
  let ticks = 0;
  setInterval(() => fs.writeFileSync(path.join(directory, 'heartbeat'), String(++ticks)), 20);
  setTimeout(() => process.exit(0), 6000);
`;

async function startFixture(script: string) {
  const directory = await fixtureDirectory();
  const controller = new AbortController();
  controllers.push(controller);
  const result = runHeadlessProcess(
    process.execPath,
    ['-e', script, directory],
    controller.signal
  );
  await vi.waitFor(
    () => expect(existsSync(join(directory, 'ready'))).toBe(true),
    {
      timeout: 3000,
      interval: 10
    }
  );
  return { directory, controller, result };
}

describe('headless browser process lifecycle', () => {
  it('captures normal output, including a split UTF-8 character', async () => {
    const result = await runHeadlessProcess(process.execPath, [
      '-e',
      `
      process.stdout.write(Buffer.from([0xe2]));
      process.stderr.write('diagnostic');
      setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac])), 10);
    `
    ]);
    expect(result).toEqual({
      ok: true,
      code: 0,
      stdout: '€',
      stderr: 'diagnostic'
    });
  });

  it('preserves nonzero exit status and spawn errors', async () => {
    const result = await runHeadlessProcess(process.execPath, [
      '-e',
      `
      process.stderr.write('renderer failed'); process.exitCode = 7;
    `
    ]);
    expect(result).toEqual({
      ok: false,
      code: 7,
      stdout: '',
      stderr: 'renderer failed'
    });
    const missing = await runHeadlessProcess(
      join(await fixtureDirectory(), 'missing-browser'),
      []
    );
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('ENOENT');
  });

  it('accepts large DOM output from an embedded image without terminating the renderer', async () => {
    const length = 17 * 1024 * 1024;
    const result = await runHeadlessProcess(process.execPath, [
      '-e',
      `
      process.stdout.write('x'.repeat(${length}));
    `
    ]);
    expect(result.ok).toBe(true);
    expect(result.stdout.length).toBe(length);
  });

  it('does not start a process for an already-aborted request', async () => {
    const directory = await fixtureDirectory();
    const controller = new AbortController();
    controller.abort();
    const result = await runHeadlessProcess(
      process.execPath,
      [
        '-e',
        `
      require('node:fs').writeFileSync(process.argv[1], 'unexpected write');
    `,
        join(directory, 'started')
      ],
      controller.signal
    );
    expect(result.code).toBe('ABORTED');
    expect(result.ok).toBe(false);
    await delay(100);
    expect(existsSync(join(directory, 'started'))).toBe(false);
  });

  it('aborts a hanging process and waits until its writes have stopped', async () => {
    const job = await startFixture(`${heartbeat}
      fs.writeFileSync(path.join(directory, 'ready'), 'ready');
    `);
    await vi.waitFor(() =>
      expect(existsSync(join(job.directory, 'heartbeat'))).toBe(true)
    );
    job.controller.abort();
    expect(await job.result).toMatchObject({ ok: false, code: 'ABORTED' });
    const lastWrite = await readFile(join(job.directory, 'heartbeat'), 'utf8');
    await delay(120);
    expect(await readFile(join(job.directory, 'heartbeat'), 'utf8')).toBe(
      lastWrite
    );
  });

  it.skipIf(process.platform === 'win32')(
    'force-kills a process that ignores SIGTERM',
    async () => {
      const job = await startFixture(`${heartbeat}
      process.on('SIGTERM', () => fs.writeFileSync(path.join(directory, 'terminated'), 'signal received'));
      fs.writeFileSync(path.join(directory, 'ready'), 'ready');
    `);
      job.controller.abort();
      expect(await job.result).toMatchObject({ ok: false, code: 'ABORTED' });
      expect(await readFile(join(job.directory, 'terminated'), 'utf8')).toBe(
        'signal received'
      );
      const lastWrite = await readFile(
        join(job.directory, 'heartbeat'),
        'utf8'
      );
      await delay(120);
      expect(await readFile(join(job.directory, 'heartbeat'), 'utf8')).toBe(
        lastWrite
      );
    }
  );

  it.skipIf(process.platform === 'win32').each([false, true])(
    'stops a SIGTERM-ignoring descendant with inherited pipes (parent exits before abort: %s)',
    async (exitBeforeAbort) => {
      const descendant = `${heartbeat}
        process.on('SIGTERM', () => {});
        fs.writeFileSync(path.join(directory, 'ready'), 'ready');
      `;
      const job = await startFixture(`
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, process.argv[1]], {
          stdio: ['ignore', 'inherit', 'inherit']
        });
        ${exitBeforeAbort ? 'child.unref();' : "process.on('SIGTERM', () => process.exit(0));"}
        ${exitBeforeAbort ? '' : 'setTimeout(() => process.exit(0), 6000);'}
      `);
      // In the early-exit case the parent has no live handles after spawning;
      // only the descendant's inherited stdout/stderr keep runHeadlessProcess pending.
      if (exitBeforeAbort) await delay(100);
      await vi.waitFor(() =>
        expect(existsSync(join(job.directory, 'heartbeat'))).toBe(true)
      );
      job.controller.abort();
      expect(await job.result).toMatchObject({ ok: false, code: 'ABORTED' });
      const lastWrite = await readFile(
        join(job.directory, 'heartbeat'),
        'utf8'
      );
      await delay(120);
      expect(await readFile(join(job.directory, 'heartbeat'), 'utf8')).toBe(
        lastWrite
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'bounds the wait when an escaped descendant retains output streams',
    async () => {
      const descendant = `${heartbeat}
      fs.writeFileSync(path.join(directory, 'ready'), String(process.pid));
    `;
      const job = await startFixture(`
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, process.argv[1]], {
        detached: true, stdio: ['ignore', 'inherit', 'inherit']
      });
      child.unref();
    `);
      escapedChildren.push(
        Number(await readFile(join(job.directory, 'ready'), 'utf8'))
      );
      const started = Date.now();
      job.controller.abort();
      const result = await job.result;
      expect(result).toMatchObject({ ok: false, code: 'ABORTED' });
      expect(result.stderr).toContain('Output streams did not close');
      expect(Date.now() - started).toBeLessThan(4000);
    }
  );
});
