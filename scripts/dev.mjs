import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
await import('./build.mjs');
const server = await createServer();
await server.listen();
const env = { ...process.env, NEXUS_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('exit', async () => {
  await server.close();
  process.exit();
});
