# SSH 连接

## 使用 Nexus 内置终端

添加设备并保存 SSH 地址、端口、用户名和认证信息，点击「SSH 连接」。内置终端和 SFTP 使用 ssh2，不需要本机 `ssh.exe`。

- 密码和私钥从本机加密存储读取；私钥文件在保存设备时导入。
- Windows SSH Agent 使用 OpenSSH 的命名管道，选择此认证方式前请启动 `ssh-agent` 并用 `ssh-add` 加入密钥。
- 首次连接需要核对 SHA-256 主机指纹，信任记录保存在 Nexus 数据库中。密钥变化时拒绝连接，先从控制台核实服务器身份。
- 终端支持多会话。收起窗口不关闭连接，关闭标签结束会话，断线后可点击「重新连接」。重新连接建立新会话，不会恢复已经结束的远程 shell。
- Esc、Tab 和 Ctrl+C 在终端中发送到远端。终端窗口的关闭按钮只收起窗口。
- `Ctrl+Shift+C` 复制选中内容，`Ctrl+V` / `Ctrl+Shift+V` 粘贴，也可使用工具栏与右键菜单。Ctrl+C 保留远端中断行为。
- 粘贴按远端的 bracketed paste 模式处理；不支持该模式的 shell 可能立即执行多行内容。单次最多读取 64 KB，请先检查剪贴板中的命令。
- 搜索框可以在当前终端输出中查找文字，支持上一处 / 下一处；`Ctrl+Shift+F` 聚焦搜索。清屏只整理当前视图，重新打开仍可能恢复最近输出。
- 终端输出保存在内存，恢复窗口显示最近约 1 MB 内容，退出应用后清除。
- 点击主窗口 × 默认隐藏到托盘，不关闭 SSH。右键托盘的「完全退出」才会结束应用；关闭行为可在设置中修改。

## Windows 能使用 SSH 吗？

可以。需要区分客户端和服务端：

| 场景                                    | 需要什么                                    |
| --------------------------------------- | ------------------------------------------- |
| 在 Windows 上使用 Nexus 内置终端和 SFTP | 不需要安装本机 OpenSSH Client               |
| 在 PowerShell 中使用 `ssh` 命令         | 本机 OpenSSH Client                         |
| 让 Nexus 连接一台 Windows 电脑          | 目标 Windows 的 OpenSSH Server 和 sshd 服务 |

本机要使用 PowerShell 的 `ssh` 命令，可在管理员 PowerShell 中安装客户端：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
ssh -V
```

连接 Windows 目标电脑时，在目标机的管理员 PowerShell 中执行：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue
```

确认防火墙和网络允许访问 TCP 22，不要关闭整个防火墙。企业策略和组件源可能影响安装，以系统实际结果为准。

Nexus 中选择 Windows PC，填写实际用户名。Windows Hello PIN 不是 SSH 密码；域账户和 Microsoft 账户需遵守服务端账户策略。用户名支持域和邮箱格式。

Windows 快捷操作使用 PowerShell 读取服务、日志和系统信息，不发送 Linux 的 systemctl、journalctl 或关机命令。SFTP 路径以目标返回为准，例如 `/C:/Users/yourname`，不要按本机路径规则猜测。

## macOS 和 NAS

- macOS：在「系统设置 → 通用 → 共享」中启用远程登录，使用允许登录的账户。快捷操作使用 launchctl、系统日志和 sw_vers。
- Linux：服务操作按 systemd、OpenRC 和 service 适配；工具不存在或权限不足时显示错误，不自动提权。
- NAS：在厂商管理界面启用 SSH / SFTP。实际系统未知时不执行 Linux 专用命令；通用安装脚本不适用于所有专有 NAS。

## 故障排查

1. 核对地址、端口和网络。PowerShell 的 `Test-NetConnection example.com -Port 22` 只检查 TCP 连通，不验证身份。
2. 核对主机指纹。外部 OpenSSH 的 known_hosts 与 Nexus 信任记录相互独立。
3. SSH 能连接、SFTP 不能连接时，检查目标的 SFTP 子系统和账户限制。软件部署也需要 SFTP 上传脚本。
4. 内置认证不自动处理登录后的多因素挑战；使用专用密钥或服务端允许的密码认证。
5. 只读快捷操作不会自动 sudo。软件部署的 sudo 提示由安装终端处理。

参考：[Microsoft OpenSSH](https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse)、[macOS 远程登录](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)。
