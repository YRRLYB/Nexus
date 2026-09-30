import { Server, type Connection } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import {
  discoveryCommands,
  discoveryShellCommand,
  type SourceResult,
} from '../../electron/discovery';
export const discoveryFixture: SourceResult[] = [
  {
    source: 'processes',
    output:
      '101\t1\t3.4\t1.2\tnode\t/srv/nexus-web\t/usr/bin/node\n102\t101\t0.5\t0.3\tnode\t/srv/nexus-web\t/usr/bin/node\n202\t1\t1.2\t2.5\tpython3\t/opt/weather-bot\t/usr/bin/python3\n303\t1\t0.1\t0.1\tsshd\t/\t/usr/sbin/sshd\n',
  },
  {
    source: 'services',
    output:
      'nginx.service loaded active running A high performance web server\nssh.service loaded active running OpenBSD Secure Shell server\n',
  },
  {
    source: 'containers',
    output:
      JSON.stringify({
        name: 'notes-web-1',
        image: 'ghcr.io/example/notes:latest',
        state: 'Up 3 days',
        ports: '0.0.0.0:8080->80/tcp',
        project: 'notes',
      }) + '\n',
  },
  {
    source: 'ports',
    output:
      'tcp LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=101,fd=18))\nudp UNCONN 0 0 127.0.0.1:53 0.0.0.0:*\n',
  },
  { source: 'timers', error: 'Failed to connect to bus: Permission denied' },
  { source: 'cron', output: '0 3 * * * | current user | /opt/backup.sh\n' },
];

export async function startDiscoveryServer() {
  const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey;
  const clients = new Set<Connection>();
  const control = { fail: false, requests: [] as string[] };
  const server = new Server({ hostKeys: [key] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'test' && ctx.password === 'fixture-pass')
        ctx.accept();
      else ctx.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        accept().on('exec', (accept, _reject, info) => {
          control.requests.push(info.command);
          const stream = accept();
          stream.on('error', () => {});
          if (info.command === 'hang') return;
          if (info.command === 'unicode') {
            const value = Buffer.from('中文项目目录');
            stream.write(value.subarray(0, 2));
            setTimeout(() => {
              stream.write(value.subarray(2));
              stream.exit(0);
              stream.end();
            }, 10);
            return;
          }
          if (info.command === 'large') {
            stream.write('x'.repeat(8192));
            stream.exit(0);
            stream.end();
            return;
          }
          if (info.command === 'uname -s') {
            stream.write('Linux\n');
            stream.exit(0);
            stream.end();
            return;
          }
          const source = discoveryFixture.find(
            (r) => discoveryShellCommand(discoveryCommands[r.source]) === info.command,
          );
          if (!source || control.fail || source.error) {
            stream.stderr.write(source?.error || 'permission denied');
            stream.exit(1);
          } else {
            stream.write(source.output!);
            stream.exit(0);
          }
          stream.end();
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    ...control,
    control,
    port: (server.address() as { port: number }).port,
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
