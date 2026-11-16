import { execFile, spawn } from 'node:child_process';
import * as path from 'node:path';

export interface ProcessResult {
  ok: boolean;
  code: number | string;
  stdout: string;
  stderr: string;
}

const TERMINATION_GRACE_MS = 1_000;
const STREAM_CLOSE_GRACE_MS = 1_000;

export function runHeadlessProcess(
  command: string,
  args: string[],
  signal?: AbortSignal
): Promise<ProcessResult> {
  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      code: 'ABORTED',
      stdout: '',
      stderr: 'Browser process cancelled.'
    });
  }

  return new Promise((resolve) => {
    const output = { stdout: '', stderr: '' };
    let settled = false;
    let stopped: { code: string; message: string } | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // A separate POSIX group lets cancellation reach only this browser's tree.
      detached: process.platform !== 'win32',
      windowsHide: true
    });

    const terminate = (force: boolean) => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        if (force) {
          child.kill('SIGKILL');
        } else {
          // Windows signals kill only the parent. Ask the OS to stop its owned
          // tree before losing that parent, and bound the taskkill helper too.
          const taskkill = path.join(
            process.env.SystemRoot ?? 'C:\\Windows',
            'System32',
            'taskkill.exe'
          );
          execFile(
            taskkill,
            ['/PID', String(child.pid), '/T', '/F'],
            {
              windowsHide: true,
              timeout: TERMINATION_GRACE_MS
            },
            (error) => {
              if (error && !settled) child.kill('SIGKILL');
            }
          );
        }
      } else {
        // The group may already have exited between close and cancellation.
        // Falling back to ChildProcess.kill preserves its exited-process guard.
        try {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          child.kill(force ? 'SIGKILL' : 'SIGTERM');
        }
      }
    };

    const finish = (code: number | string) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(closeTimer);
      signal?.removeEventListener('abort', abort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      resolve({
        ok: !stopped && code === 0,
        code: stopped?.code ?? code,
        stdout: output.stdout,
        stderr: stopped
          ? `${output.stderr}${output.stderr ? '\n' : ''}${stopped.message}`
          : output.stderr
      });
    };

    const stop = (code: string, message: string) => {
      if (settled || stopped) return;
      stopped = { code, message };
      forceTimer = setTimeout(() => {
        // child.killed means a signal was sent, not that the process exited.
        terminate(true);
        closeTimer = setTimeout(() => {
          // A descendant can retain inherited pipes after the parent exits.
          // Stop waiting for those streams after requesting an owned-tree kill.
          stopped!.message +=
            ' Output streams did not close after termination.';
          finish(code);
        }, STREAM_CLOSE_GRACE_MS);
      }, TERMINATION_GRACE_MS);
      terminate(false);
    };

    const abort = () => stop('ABORTED', 'Browser process cancelled.');
    const capture = (stream: 'stdout' | 'stderr', chunk: string) => {
      if (settled || stopped) return;
      output[stream] += chunk;
    };

    child.stdout
      ?.setEncoding('utf8')
      .on('data', (chunk: string) => capture('stdout', chunk));
    child.stderr
      ?.setEncoding('utf8')
      .on('data', (chunk: string) => capture('stderr', chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      if (stopped) {
        // A failed kill is not evidence of exit; keep escalation/close timers.
        if (!child.pid) finish(stopped.code);
      } else {
        output.stderr = error.message;
        finish(error.code ?? 'ERROR');
      }
    });
    child.on('close', (code, exitSignal) => {
      // The parent may exit while a child that ignored SIGTERM remains alive.
      if (stopped && !settled && process.platform !== 'win32') terminate(true);
      finish(code ?? exitSignal ?? 'UNKNOWN');
    });
    signal?.addEventListener('abort', abort, { once: true });
    // Cover cancellation between the initial check and listener registration.
    if (signal?.aborted) abort();
  });
}
