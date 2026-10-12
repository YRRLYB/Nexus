import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Eye,
  File,
  Folder,
  FolderPlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { Device, FileEntry, FileListing, FilePreview, TransferTask } from '../shared/types';
import { api, bytes, errorText, Modal } from './ui';
import { localFilePath } from '../shared/preview';
const remoteJoin = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;
const localJoin = localFilePath;
export function Files({ device, close }: { device: Device; close: () => void }) {
  const [local, setLocal] = useState<FileListing>({ path: '', entries: [] });
  const [remote, setRemote] = useState<FileListing>({ path: '.', entries: [] });
  const [remoteInput, setRemoteInput] = useState('.');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<TransferTask[]>([]);
  const [localFilter, setLocalFilter] = useState('');
  const [remoteFilter, setRemoteFilter] = useState('');
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [edit, setEdit] = useState<{
    action: 'mkdir' | 'rename';
    source?: string;
    value: string;
  } | null>(null);
  const active = useRef(false);
  const remotePathRef = useRef(remote.path);
  const localPathRef = useRef(local.path);
  remotePathRef.current = remote.path;
  localPathRef.current = local.path;
  async function loadRemote(path: string) {
    const listing = await api.listRemote(device.id, path);
    setRemote(listing);
    setRemoteInput(listing.path);
  }
  async function run(fn: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () => {
      const results = await Promise.allSettled([api.listLocal().then(setLocal), loadRemote('.')]);
      const errors = results.filter((r) => r.status === 'rejected');
      if (errors.length)
        throw new Error(
          errors.map((r) => errorText((r as PromiseRejectedResult).reason)).join('；'),
        );
    });
    const unsubscribe = api.onTransfer((task) => {
      if (task.deviceId !== device.id) return;
      setTasks((previous) =>
        previous.some((item) => item.id === task.id)
          ? previous.map((item) => (item.id === task.id ? task : item))
          : [...previous, task],
      );
      if (task.state === 'complete') {
        void loadRemote(remotePathRef.current).catch(() => {});
        void api
          .listLocal(localPathRef.current || undefined)
          .then(setLocal)
          .catch(() => {});
      }
    });
    void api
      .transfers()
      .then((items) =>
        setTasks((previous) => [
          ...items.filter(
            (item) =>
              item.deviceId === device.id && !previous.some((value) => value.id === item.id),
          ),
          ...previous,
        ]),
      )
      .catch(() => {});
    return unsubscribe;
  }, []);
  async function upload(paths?: string[], folders = false) {
    await run(async () => {
      const queued = await api.upload(device.id, remote.path, paths, folders);
      if (queued.length) setNotice(`${queued.length} 项已加入上传队列`);
    });
  }
  async function showPreview(file: FileEntry, side: 'local' | 'remote') {
    await run(async () => {
      const path =
        side === 'local' ? localJoin(local.path, file.name) : remoteJoin(remote.path, file.name);
      setPreview(
        side === 'local' ? await api.previewLocal(path) : await api.previewRemote(device.id, path),
      );
    });
  }
  async function mutation() {
    if (
      !edit ||
      !edit.value.trim() ||
      /[\\/\0]/.test(edit.value) ||
      ['.', '..'].includes(edit.value)
    ) {
      setError('请输入不含路径分隔符的有效名称');
      return;
    }
    const value = edit;
    await run(async () => {
      await api.mutateRemote(
        device.id,
        value.action,
        value.source || remoteJoin(remote.path, value.value),
        value.action === 'rename' ? remoteJoin(remote.path, value.value) : undefined,
      );
      setEdit(null);
      await loadRemote(remote.path);
    });
  }
  const localEntries = local.entries.filter((file) =>
    file.name.toLocaleLowerCase().includes(localFilter.toLocaleLowerCase()),
  );
  const remoteEntries = remote.entries.filter((file) =>
    file.name.toLocaleLowerCase().includes(remoteFilter.toLocaleLowerCase()),
  );
  const entry = (file: FileEntry, side: 'local' | 'remote') => (
    <div className="file-row" key={file.name}>
      <button
        className="file-name"
        disabled={busy}
        title={file.name}
        onDoubleClick={() => {
          if (file.directory || file.symlink)
            void run(() =>
              side === 'local'
                ? api.listLocal(localJoin(local.path, file.name)).then(setLocal)
                : loadRemote(remoteJoin(remote.path, file.name)),
            );
        }}
      >
        <span className={file.directory ? 'folder-icon' : ''}>
          {file.directory ? <Folder size={18} /> : <File size={18} />}
        </span>
        <span>
          {file.name}
          {file.symlink && ' ↗'}
        </span>
      </button>
      <span className="file-size">{file.directory ? '—' : bytes(file.size)}</span>
      <span className="file-mode">{file.mode}</span>
      <div className="file-actions">
        {side === 'local' && !file.directory && (
          <button
            title="预览"
            aria-label={`本地预览 ${file.name}`}
            disabled={busy}
            onClick={() => void showPreview(file, side)}
          >
            <Eye size={15} />
          </button>
        )}
        {side === 'local' ? (
          !file.symlink && (
            <button
              title="上传"
              aria-label={`上传 ${file.name}`}
              disabled={busy}
              onClick={() => void upload([localJoin(local.path, file.name)])}
            >
              <ArrowUpFromLine size={15} />
            </button>
          )
        ) : (
          <>
            {!file.directory && (
              <button
                title="预览"
                aria-label={`预览 ${file.name}`}
                disabled={busy}
                onClick={() => void showPreview(file, side)}
              >
                <Eye size={15} />
              </button>
            )}
            {!file.symlink && (
              <button
                title="下载"
                aria-label={`下载 ${file.name}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (await api.download(device.id, remoteJoin(remote.path, file.name))) {
                      setNotice('已加入下载队列');
                    }
                  })
                }
              >
                <ArrowDownToLine size={15} />
              </button>
            )}
            <button
              title="重命名"
              disabled={busy}
              onClick={() =>
                setEdit({
                  action: 'rename',
                  source: remoteJoin(remote.path, file.name),
                  value: file.name,
                })
              }
            >
              <Pencil size={14} />
            </button>
            <button
              title="删除"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.mutateRemote(device.id, 'delete', remoteJoin(remote.path, file.name));
                  await loadRemote(remote.path);
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
  return (
    <Modal
      wide
      title={`文件 · ${device.name}`}
      subtitle="SFTP · 双击进入目录，可拖入文件或目录上传。收起窗口不停止传输。"
      close={() => (preview ? setPreview(null) : !busy && close())}
    >
      <div className="file-panes">
        <section>
          <div className="pane-title">
            <span>本地文件</span>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const path = await api.pickLocalFolder();
                  if (path) setLocal(await api.listLocal(path));
                })
              }
            >
              <Folder size={15} />
              选择目录
            </button>
          </div>
          <div className="path-bar">
            <button
              aria-label="本地上级目录"
              disabled={busy || !local.path}
              onClick={() =>
                void run(async () => setLocal(await api.listLocal(localJoin(local.path, '..'))))
              }
            >
              <ArrowLeft size={16} />
            </button>
            <span title={local.path}>{local.path || '读取中…'}</span>
            <button
              aria-label="刷新本地文件"
              disabled={busy}
              onClick={() =>
                void run(async () => setLocal(await api.listLocal(local.path || undefined)))
              }
            >
              <RefreshCw size={15} />
            </button>
          </div>
          <input
            className="file-filter"
            aria-label="筛选本地文件"
            placeholder="按名称筛选"
            value={localFilter}
            onChange={(event) => setLocalFilter(event.target.value)}
          />
          <div className="file-list">
            {localEntries.map((file) => entry(file, 'local'))}
            {!localEntries.length && (
              <p className="file-empty">{localFilter ? '没有匹配文件' : '目录为空'}</p>
            )}
          </div>
        </section>
        <section
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void upload(api.droppedPaths(Array.from(e.dataTransfer.files)));
          }}
        >
          <div className="pane-title">
            <span>远程服务器</span>
            <div>
              <button disabled={busy} onClick={() => setEdit({ action: 'mkdir', value: '' })}>
                <FolderPlus size={15} />
                新建
              </button>
              <button disabled={busy} onClick={() => void upload()}>
                <ArrowUpFromLine size={15} />
                上传
              </button>
              <button disabled={busy} onClick={() => void upload(undefined, true)}>
                <Folder size={15} />
                上传目录
              </button>
            </div>
          </div>
          <form
            className="path-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => loadRemote(remoteInput));
            }}
          >
            <button
              type="button"
              aria-label="远程上级目录"
              disabled={busy}
              onClick={() => void run(() => loadRemote(remoteJoin(remote.path, '..')))}
            >
              <ArrowLeft size={16} />
            </button>
            <input
              aria-label="远程路径"
              disabled={busy}
              value={remoteInput}
              onChange={(e) => setRemoteInput(e.target.value)}
            />
            <button aria-label="刷新远程文件" disabled={busy}>
              <RefreshCw size={15} />
            </button>
          </form>
          <input
            className="file-filter"
            aria-label="筛选远程文件"
            placeholder="按名称筛选"
            value={remoteFilter}
            onChange={(event) => setRemoteFilter(event.target.value)}
          />
          <div className="file-list">
            {remoteEntries.map((file) => entry(file, 'remote'))}
            {!remoteEntries.length && (
              <p className="file-empty">
                {busy ? '正在连接服务器…' : remoteFilter ? '没有匹配文件' : '目录为空或尚未连接'}
              </p>
            )}
          </div>
        </section>
      </div>
      {edit && (
        <form
          className="inline-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void mutation();
          }}
        >
          <label>
            {edit.action === 'mkdir' ? '文件夹名称' : '新名称'}
            <input
              autoFocus
              required
              value={edit.value}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
            />
          </label>
          <button disabled={busy} className="primary">
            确定
          </button>
          <button type="button" disabled={busy} onClick={() => setEdit(null)}>
            取消
          </button>
        </form>
      )}
      <div className="transfer-status">
        {busy && <LoaderCircle size={16} className="spin" />}
        {busy
          ? '正在处理，请稍候…'
          : notice || '同名文件可跳过、覆盖或保留两份；同名目录可合并。不跟随符号链接。'}
      </div>
      {tasks.some((task) => ['complete', 'failed', 'cancelled'].includes(task.state)) && (
        <button
          onClick={() =>
            void api
              .clearTransfers(device.id)
              .then(() => api.transfers())
              .then((items) => setTasks(items.filter((task) => task.deviceId === device.id)))
              .catch((failure) => setError(errorText(failure)))
          }
        >
          清空已结束任务
        </button>
      )}
      {!!tasks.length && (
        <div className="transfer-queue" aria-label="传输队列">
          {tasks
            .slice()
            .reverse()
            .map((task) => (
              <div className="transfer-task" key={task.id}>
                <span>
                  {task.direction === 'upload' ? '↑' : '↓'} {task.name} ·{' '}
                  {
                    {
                      queued: '排队中',
                      running: '传输中',
                      waiting: '等待选择',
                      complete: '已完成',
                      failed: '失败',
                      cancelled: '已取消',
                    }[task.state]
                  }{' '}
                  · {bytes(task.transferred)} / {bytes(task.total)} · {task.files} 个文件
                  {!!task.skipped && ` · 跳过 ${task.skipped} 项`}
                </span>
                <div className="task-actions">
                  {['queued', 'running', 'waiting'].includes(task.state) && (
                    <button
                      onClick={() =>
                        void api
                          .cancelTransfer(task.id)
                          .catch((failure) => setError(errorText(failure)))
                      }
                    >
                      取消传输
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(task.state) && (
                    <button
                      onClick={() =>
                        void api
                          .retryTransfer(task.id)
                          .catch((failure) => setError(errorText(failure)))
                      }
                    >
                      重试传输
                    </button>
                  )}
                </div>
                {task.state === 'running' && (
                  <progress value={task.transferred} max={task.total || 1} />
                )}
                {task.error && <p className="error">{task.error}</p>}
              </div>
            ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <Modal
          wide
          title={`预览 · ${preview.path.split(/[\\/]/).pop() || preview.path}`}
          subtitle={`${preview.kind === 'image' ? '图片' : '文本'} · ${bytes(preview.size)}${preview.truncated ? ' · 仅显示开头 256 KB' : ''}`}
          close={() => setPreview(null)}
        >
          {preview.kind === 'image' ? (
            <div className="preview-image-wrap">
              <img src={preview.data} alt={preview.path} />
            </div>
          ) : (
            <pre className="preview-text">{preview.text}</pre>
          )}
          {preview.truncated && (
            <p className="helper">文件较大，仅读取前 256 KB；如需完整内容请下载。</p>
          )}
        </Modal>
      )}
    </Modal>
  );
}
