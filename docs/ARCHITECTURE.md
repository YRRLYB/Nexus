# 架构与开发约定

## 分层

```text
React / TypeScript
  设备空间、浮动详情、文件面板、按需工具
           │ 明确列出的 NexusAPI
Electron sandbox preload / contextBridge
           │ IPC 参数校验 + 主 frame 校验
Electron main
  ├─ Store → sql.js SQLite → 临时文件原子替换
  ├─ safeStorage → Windows DPAPI / 操作系统凭据加密
  ├─ fetchProbe → ServerStatus JSON
  ├─ 系统 PowerShell → 本机 OpenSSH 交互式终端
  └─ ssh2 → SFTP / 固定只读命令 / 经确认的电源命令
```

Windows 是首要平台，选用 Electron 避免 Rust / WebView2 编译环境要求。SQLite 使用 sql.js，无需用户安装 SQLite，也避免原生数据库模块与 Electron ABI 版本不匹配。数据库是本地小规模个人设备配置库，不用于监控历史时序数据。

## 状态与凭据

`shared/canvas.ts` 负责鼠标锚定缩放和视角定位；`src/useCanvas.ts` 将空白拖动映射为视角移动，设备拖动保持独立。设备世界坐标可为负数，不再限制在固定大小的面板内。系统标识由 `shared/os.ts` 识别，由 `SystemIcon` 使用本地 SVG 呈现。

`nexus.camera` 和 `nexus.desktop` 两项本地存储只保存非敏感视角和外观。F11 全屏通过受限窗口 IPC 操作；Windows 原生全屏事件用事件本身携带的进入 / 离开语义同步前端，避免事件内读取到旧的窗口状态。

`devices` 保存通过 Zod 白名单校验的非敏感元数据。`secrets` 保存经系统安全能力加密的字符串，设备 ID 为索引。接口 Token 使用独立索引。`hosts` 保存 SFTP/快捷命令已确认的 SSH 主机 SHA-256 指纹。`settings` 保存非敏感应用设置。

渲染进程只能看到 `hasCredential` / `hasToken`，无法从 bootstrap 读取密码；复制密码由主进程确认后直接写系统剪贴板。所有设备名称、备注、命令输出由 React 以文本呈现。

SFTP 每次操作建立 SSH 会话，结束后关闭。此方式牺牲一些延迟以减少闲置连接、断线恢复及密钥修改后的会话一致性问题。已有指纹不会反复询问；连接错误、超时和中途断线均结束等待状态。

## 开发与验证

`electron/discovery.ts` 通过固定的只读命令识别 Linux 运行内容，渲染进程只能提交设备 ID 和刷新标记。主进程检查 SSH 能力、设备类型及凭据，再复用已确认的主机指纹。每次扫描使用一个 SSH 连接、独立的采集通道；通道各自限制超时和输出长度，单项失败不抹掉其他结果。所有通道结束后关闭连接。

识别结果由本地规则从 Docker / Compose、systemd、进程目录和监听 PID 生成，明确区分确认的运行实体与推测的项目。缓存只存于当前主进程内存，5 分钟有效，同一设备的并发请求共享扫描；保存或删除设备时失效，不写回设备类型、标签或用户备注。

`src/Discovery.tsx` 在打开已配置的 Linux 设备详情时触发扫描，提供摘要和按需展开的分类视图。视图切换后丢弃旧组件的异步回调；刷新失败保留当前视图的上次结果与时间。

字体颜色通过 `--text-primary`、`--text-secondary` 及状态色集中控制。常用辅助文字至少 15px，正文 16px；透明面板使用较高的不透明度保证对比。桌面回归读取关键文本的最终样式，验证字号和至少 4.5:1 的对比度。

- 类型与输入验证放在 `shared/`；增加 IPC 方法必须同步更新类型、preload 和主进程校验。
- 新的远程命令应作为可枚举的固定操作加入，不能把不受信任的任意字符串拼进 shell。
- 复制 SSH 命令针对 Windows PowerShell 引号规则；启动终端通过 UTF-16LE EncodedCommand 传参，不将密码放入参数。
- 修改监控适配应运行 `npm test`。修改 UI 运行 `npm run test:ui`，其临时用户数据与真实工作台隔离。
- `tests/ssh.test.ts` 在回环接口临时端口启动真实 ssh2 服务端，验证 SSH 和 SFTP 协议。不会连接生产服务器。
- 新版本同步更新 `package.json` / lockfile / `CHANGELOG.md` 后打包，产物采用 `Nexus-${version}-Windows-x64.exe` 命名。
- 发布只使用明确列出的 `dist/`、`dist-electron/`、生产依赖；不把研究目录或用户探针 ZIP 加入 `extraResources`。

## v0.4.0 设备适配与文件预览

`shared/device.ts` 根据设备类型和填写的系统统一计算操作边界。Windows 快捷操作由主进程生成固定的 PowerShell 编码命令，macOS 使用原生服务 / 日志命令，Linux 对非 systemd 系统降级。NAS 默认关闭电源能力；只有明确的 Linux 系统且主动开启对应能力时，才允许电源命令。运行识别和安装引导只向 Linux 设备提供，不根据渲染进程提交的任意命令执行。

系统 SSH 终端启动前检测本机 `ssh -V`；内置 ssh2 不依赖系统客户端。SSH 用户名允许 Windows 域账户 / 邮箱形式，用 `-l` 单独传参，避免与主机名拼接的歧义。

`electron/preview.ts` 从已打开的本地 / SFTP 文件句柄检查普通文件属性后，最多读取文本 256 KB 或图片 8 MB。文本必须是 UTF-8；截断可能发生在多字节字符边界，解码器保留完整前缀。图片按魔数而非仅扩展名识别，头部像素尺寸先校验，限制 4000 万像素 / 单边 16384。SVG / HTML 等始终作为 React 转义文本输出，不提供执行或远程编辑。

远程预览使用既有主机信任库和 30 秒 SFTP 操作超时，不生成临时下载文件。预览数据只保存在界面内存，关闭后丢弃。弹窗通过 portal 独立挂载，管理初始焦点、Tab 循环、Esc 关闭和焦点恢复。

安装引导只把固定公开脚本的下载 / 审阅 / 手动执行命令写入剪贴板，不在远程后台执行。Docker 脚本不会自动覆盖现有安装；探针脚本固定 v1.8.1 和发布文件校验值，通过受限 systemd 动态用户运行，并保留配置 / 节点 ID。`--dry-run` 不创建文件、不下载、不控制服务。生产服务器上尚未执行本次自动安装脚本。

## MVP 的有意限制

无云端、无网络自动发现、无内嵌终端、无监控数据历史库、无递归 SFTP 目录传输。跨平台构建暂未验收。密钥轮换需要人工核实并处理信任记录；当前不提供忽略主机密钥验证的入口。
