import { z } from 'zod';
export const deviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  type: z.enum(['linux-server', 'linux-vps', 'windows', 'macos', 'nas']),
  icon: z.enum(['server', 'cloud', 'database', 'monitor', 'box']),
  tags: z.array(z.string().trim().min(1).max(32)).max(12),
  notes: z.string().max(4000),
  os: z.string().max(160),
  location: z.string().trim().max(80).optional(),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  connection: z.object({
    host: z
      .string()
      .max(253)
      .refine((v) => !v || /^(?!-)[a-zA-Z0-9:.\-]+$/.test(v), '请输入有效的 IP 或主机名'),
    port: z.number().int().min(1).max(65535),
    username: z
      .string()
      .max(192)
      .regex(/^(?:[a-zA-Z0-9_.-]{1,64}\\)?[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,127}$/),
    auth: z.enum(['password', 'key', 'agent']),
    keyPath: z
      .string()
      .max(2048)
      .refine((v) => !/[\r\n\0]/.test(v)),
  }),
  probe: z.object({ enabled: z.boolean(), deviceId: z.string().max(256) }),
  capabilities: z.object({
    ssh: z.boolean(),
    sftp: z.boolean(),
    restart: z.boolean(),
    shutdown: z.boolean(),
  }),
});
export const inputSchema = z.object({
  device: deviceSchema,
  credential: z
    .object({
      password: z.string().max(16384).optional(),
      passphrase: z.string().max(16384).optional(),
      privateKey: z.string().max(65536).optional(),
    })
    .optional(),
  clearCredential: z.boolean().optional(),
});
export const settingsSchema = z.object({
  probeUrl: z
    .string()
    .url()
    .max(2048)
    .refine((value) => {
      const u = new URL(value);
      return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
    }, '使用不含账号密码的 HTTP(S) 地址'),
  pollSeconds: z.number().int().min(5).max(300),
  staleSeconds: z.number().int().min(30).max(3600),
});
export function remotePath(value: unknown): string {
  const path = z.string().min(1).max(4096).parse(value);
  if (/[\0\r\n]/.test(path)) throw new Error('路径包含非法字符');
  return path;
}
export const psQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function sshArgs(device: Pick<z.infer<typeof deviceSchema>, 'connection'>): string[] {
  const args = ['-p', String(device.connection.port)];
  if (device.connection.auth === 'key' && device.connection.keyPath)
    args.push('-i', device.connection.keyPath);
  args.push('-l', device.connection.username, '--', device.connection.host);
  return args;
}
