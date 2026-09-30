# Windows / macOS / NAS 的 SSH 连接

## Windows 当然可以使用 SSH

先区分两种角色：

| 场景                                    | 在哪台电脑配置    | 需要什么                                                   |
| --------------------------------------- | ----------------- | ---------------------------------------------------------- |
| Windows 连接 Linux / NAS / 其他 Windows | 运行 Nexus 的电脑 | OpenSSH **Client**                                         |
| 其他电脑连接一台 Windows                | 被连接的 Windows  | OpenSSH **Server** 和 sshd 服务                            |
| Nexus 内置文件管理 / 快捷操作           | 运行 Nexus 的电脑 | 无需系统 ssh.exe，使用内置 ssh2；目标机仍需提供 SSH / SFTP |

Windows 10/11 可以通过可选功能安装 OpenSSH。Nexus 的「探针与连接」会检测本机 `ssh -V`，并给出启用命令。仅 SSH **终端**需要本机客户端；内置 SFTP 不依赖它。

本机缺少客户端时，以管理员身份打开 PowerShell：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
ssh -V
```

重开 Nexus 后点「SSH 连接」。认证在独立终端里交互完成，密码不会拼进命令行。`SSH Agent` 使用 Windows OpenSSH 的命名管道；选择此方式前，应自行启动 `ssh-agent` 并用 `ssh-add` 加入私钥。

## 连接一台 Windows 电脑

在**目标电脑**的管理员 PowerShell 中运行：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue
```

检查防火墙和网络是否允许你访问 TCP 22。不要为了连接关闭整个防火墙。企业策略和组件源可能影响可选功能安装，以系统安装结果为准。

在 Nexus 中选择 `Windows PC`，填实际地址、端口、用户名、认证信息。Windows Hello PIN **不是** SSH 登录密码。域账户和 Microsoft 账户可能需要服务端账户策略及特定用户名格式；先用系统 SSH 验证，再填入 Nexus。

Windows 快捷命令通过 `powershell.exe -NoProfile -NonInteractive -EncodedCommand` 执行，读取 `Get-Service`、`Get-WinEvent`、`Get-CimInstance`。不会向 Windows 发送 `systemctl`、`journalctl`、`shutdown -h`。查看日志可能需要服务端授权。Windows 电源操作和 Linux 运行识别默认不提供。

SFTP 路径以服务器返回的路径为准，例如 `/C:/Users/yourname`；不要用本机 Windows 路径规则猜测远程路径。Nexus 默认从远程用户目录 `.` 开始浏览。

## macOS 与 NAS

- **macOS**：系统设置 → 通用 → 共享 → 远程登录。使用允许远程登录的账户；快捷服务列表使用 `launchctl list`，系统版本使用 `sw_vers`，日志使用系统 `log`。
- **Linux / Alpine**：服务列表优先 systemd，没有 systemd 时尝试 OpenRC / `service`；日志优先 journalctl，再尝试 logread 或可读日志文件。工具缺失和权限问题会显示错误，不自动提权。
- **NAS**：先在设备管理界面启用 SSH / SFTP。NAS 默认不提供电源操作；实际系统未知时，仅允许保守的系统信息命令。填写 Debian / Linux 等真实系统后才启用 Linux 识别与安装引导。专有 NAS 不应直接运行通用 Docker / 探针脚本，应使用厂商的应用或容器管理器。

## 主机密钥与故障排查

1. 确认地址、端口和网络可达；`Test-NetConnection example.com -Port 22` 只验证 TCP，不验证身份。
2. 核对 SSH 主机指纹。系统终端使用系统 `known_hosts`，内置功能使用 Nexus 独立信任库，两条路径可能各提示一次。
3. 主机密钥变化时先通过云控制台 / 管理面板核实，不能盲目忽略验证。
4. 「SSH 能连接、SFTP 不行」通常是目标机未启用 SFTP 子系统或账户被限制。
5. Linux 快捷操作要求免交互认证；Nexus 不处理交互式 sudo，不替你开放 root 登录。

官方参考：[Microsoft OpenSSH 安装说明](https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse)、[Apple 远程登录说明](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)。
