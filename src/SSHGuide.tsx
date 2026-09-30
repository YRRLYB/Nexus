import { useEffect, useState } from 'react';
import type { SSHStatus } from '../shared/types';
import { api } from './ui';

export function SSHGuide() {
  const [status, setStatus] = useState<SSHStatus | null>(null);
  useEffect(() => {
    let active = true;
    void api.sshStatus().then(
      (value) => active && setStatus(value),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="ssh-guide">
      <h3>Windows 可以使用 SSH</h3>
      <p className="helper">
        Nexus 内置 SSH 终端和 SFTP，不需要本机 ssh.exe。使用外部 PowerShell 的 ssh 命令时才需要
        OpenSSH Client；让其他设备连接 Windows 则需要在目标 Windows 上安装 OpenSSH Server。
      </p>
      <p className="helper" role="status">
        {status
          ? status.available
            ? `本机已检测到 ${status.version}`
            : '本机未检测到 OpenSSH Client；不影响 Nexus 内置终端和 SFTP。'
          : '正在检测本机 OpenSSH…'}
      </p>
      <details>
        <summary>本机没有 SSH？查看启用方法</summary>
        <p className="helper">以管理员身份打开 PowerShell，执行：</p>
        <pre className="guide-command">
          {'Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0\nssh -V'}
        </pre>
        <p className="helper">
          在“设置 → 可选功能”中也可以安装 OpenSSH 客户端；安装后重新打开 Nexus。
        </p>
      </details>
      <details>
        <summary>我要连接一台 Windows 电脑</summary>
        <p className="helper">在目标 Windows 的管理员 PowerShell 中执行：</p>
        <pre className="guide-command">
          {
            'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0\nStart-Service sshd\nSet-Service -Name sshd -StartupType Automatic'
          }
        </pre>
        <p className="helper">
          设备类型选 Windows PC，使用目标电脑的实际用户名与密码。还需检查防火墙的 TCP 22 规则。Nexus
          不会自动修改防火墙或提升权限。
        </p>
      </details>
    </section>
  );
}
