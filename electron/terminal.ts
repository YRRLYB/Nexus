import { execFile } from 'node:child_process';
import type { SSHStatus } from '../shared/types';

export async function systemSSHStatus(): Promise<SSHStatus> {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'ssh.exe' : 'ssh',
      ['-V'],
      {
        timeout: 3_000,
        windowsHide: true,
        maxBuffer: 16 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          available: !error,
          version: error ? '' : `${stdout}${stderr}`.trim().split(/\r?\n/)[0],
          platform: process.platform,
        });
      },
    );
  });
}
