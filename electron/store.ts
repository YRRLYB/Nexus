import initSqlJs, { type Database } from 'sql.js';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Credential, Device, Settings } from '../shared/types';
export interface Cipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
export class Store {
  private constructor(
    private db: Database,
    private path: string,
    private cipher: Cipher,
  ) {}
  static async open(path: string, cipher: Cipher) {
    const SQL = await initSqlJs();
    const db = new SQL.Database(existsSync(path) ? readFileSync(path) : undefined);
    db.run(
      'CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, data TEXT NOT NULL);',
    );
    return new Store(db, path, cipher);
  }
  private get(table: string, id: string): string | undefined {
    const stmt = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`);
    try {
      stmt.bind([id]);
      return stmt.step() ? String(stmt.get()[0]) : undefined;
    } finally {
      stmt.free();
    }
  }
  private put(table: string, id: string, data: string) {
    this.db.run(`INSERT OR REPLACE INTO ${table} (id,data) VALUES (?,?)`, [id, data]);
  }
  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = this.path + '.tmp';
    writeFileSync(temp, this.db.export(), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  private transaction(fn: () => void) {
    // Restore the in-memory state too if an atomic disk replacement fails.
    const before = this.db.export();
    try {
      fn();
      this.persist();
    } catch (error) {
      this.db.close();
      this.db = new (this.db.constructor as new (data: Uint8Array) => Database)(before);
      throw error;
    }
  }
  devices(): Device[] {
    const result = this.db.exec('SELECT data FROM devices ORDER BY rowid');
    return (result[0]?.values || []).map((row) => {
      const d = JSON.parse(String(row[0])) as Device;
      return { ...d, hasCredential: !!this.get('secrets', d.id) };
    });
  }
  device(id: string): Device {
    const d = this.devices().find((d) => d.id === id);
    if (!d) throw new Error('设备不存在');
    return d;
  }
  saveDevice(device: Device, credential?: Credential, clear = false) {
    const { hasCredential: _, ...metadata } = device;
    const encrypted = credential ? this.cipher.encrypt(JSON.stringify(credential)) : undefined;
    this.transaction(() => {
      this.put('devices', device.id, JSON.stringify(metadata));
      if (clear) this.db.run('DELETE FROM secrets WHERE id = ?', [device.id]);
      if (encrypted) this.put('secrets', device.id, encrypted);
    });
    return this.device(device.id);
  }
  move(id: string, position: Device['position']) {
    const d = this.device(id);
    d.position = position;
    return this.saveDevice(d);
  }
  deleteDevice(id: string) {
    this.transaction(() => {
      this.db.run('DELETE FROM devices WHERE id = ?', [id]);
      this.db.run('DELETE FROM secrets WHERE id = ?', [id]);
    });
  }
  credential(id: string): Credential {
    const data = this.get('secrets', id);
    return data ? JSON.parse(this.cipher.decrypt(data)) : {};
  }
  settings(): Settings {
    return {
      ...JSON.parse(
        this.get('settings', 'main') ||
          '{"probeUrl":"https://server.yrrlyb.top/json/stats.json","pollSeconds":10,"staleSeconds":90}',
      ),
      hasToken: !!this.get('secrets', 'probe-token'),
    };
  }
  saveSettings(settings: Settings, token?: string) {
    const encrypted = token ? this.cipher.encrypt(token) : undefined;
    this.transaction(() => {
      this.put('settings', 'main', JSON.stringify(settings));
      if (token === '') this.db.run('DELETE FROM secrets WHERE id = ?', ['probe-token']);
      if (encrypted) this.put('secrets', 'probe-token', encrypted);
    });
    return this.settings();
  }
  token() {
    const data = this.get('secrets', 'probe-token');
    return data ? this.cipher.decrypt(data) : undefined;
  }
  hostKey(address: string) {
    return this.get('hosts', address);
  }
  trustHost(address: string, fingerprint: string) {
    this.transaction(() => this.put('hosts', address, fingerprint));
  }
  close() {
    this.db.close();
  }
}
