# ServerStatus-Rust 探针安装教程

## 先确认你需要安装的是哪一部分

```text
Linux 服务器上的 stat_client  →  状态站 /report
                                   ↓
Windows 上的 Nexus            ←  状态站 /json/stats.json
```

Nexus 是读取现有状态站的客户端，**不包含状态站服务端，也不是一个新的探针协议**。自动脚本只安装同款 ServerStatus-Rust 客户端。你需要已有服务端、分组 ID 与分组密码；如果没有，先按照 [ServerStatus-Rust 上游](https://github.com/zdz/ServerStatus-Rust/tree/v1.8.1) 部署服务端。不要把桌面的 Bearer Token 当作探针分组密码。

已有 `stat_client` 正常上报时，不必重装。在 Nexus 填状态站的 `/json/stats.json`，导入节点，再补全 SSH 地址即可。脚本检测到活动的 `stat_client.service` 会停止，避免重复上报；不会读取本仓库本地 `research/` 的私有配置。

## 方式一：公开自动脚本

在 Nexus 内也可以安装：设备详情 → 部署软件 → ServerStatus 探针。填写 HTTPS 上报地址、组 ID、节点名称和地区代码，检查环境和脚本后确认安装，组密码在终端提示中隐藏输入。已有安装不会被覆盖。下面的脚本方式适用于直接在终端操作的情况。

支持 Linux **x86_64 / aarch64 / armv7l** 和 systemd。需要 `curl`、`unzip`、`sha256sum`。Ubuntu / Debian 可先执行 `sudo apt-get update && sudo apt-get install -y curl unzip ca-certificates`。

```sh
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/YRRLYB/Nexus/main/scripts/probe/install.sh \
  -o nexus-probe-install.sh
less nexus-probe-install.sh
sh nexus-probe-install.sh --dry-run
sudo sh nexus-probe-install.sh
```

确认后交互填写：

1. HTTPS 上报地址，例如 `https://status.example.com/report`。
2. 服务端 `hosts_group` 已配置的分组 ID。
3. 节点展示名称和所在地代码，例如 `cn`、`jp`、`hk`、`us`。
4. 分组密码，隐藏输入，不放在命令行历史中。

脚本固定使用 **v1.8.1**，按 CPU 架构选择上游 ZIP，SHA-256 校验成功后才安装。这里的哈希是开发时从上游发布文件计算并固定的值，不是上游提供的数字签名；不应把校验等同于对作者身份的独立验证。

### 无人值守安装

先通过安全渠道把密码写入仅 root 可读的文件，建议 `/root/nexus-probe-password`，权限 `600`。不要把密码写在 `--password` 参数或提交到 Git。

```sh
sudo sh nexus-probe-install.sh --yes \
  --server https://status.example.com/report \
  --group homelab --alias my-server --location cn \
  --password-file /root/nexus-probe-password
```

密码文件由调用者管理。完成后自行安全处理，不要上传。root 用户可以去掉 `sudo`。

### 安装位置与重复执行

| 内容     | 路径 / 策略                                        |
| -------- | -------------------------------------------------- |
| 客户端   | `/opt/nexus-probe/stat_client`                     |
| 配置     | `/etc/nexus-probe.env`，root 所有，权限 `600`      |
| 服务     | `/etc/systemd/system/nexus-probe.service`          |
| 节点身份 | `/var/lib/nexus-probe/.server_status_sys_id`       |
| 运行账户 | systemd `DynamicUser`，非 root 采集，默认不提权    |
| 重复安装 | 保留现有配置和节点身份，更新固定版本程序并重启服务 |
| 重新配置 | 显式传 `--reconfigure`，建议先手动备份受限配置     |

systemd 应支持 `DynamicUser` / `StateDirectory`，老旧系统需要按下面的手动方式调整。动态用户可能无法读取某些文件系统 / 扩展监控数据；这是权限边界，不会自动改成 root 运行。

安装命令成功只证明**进程已启动**，不证明分组认证与服务端入库成功。请打开状态站确认节点出现，再在 Nexus 中导入。

## 方式二：没有自动脚本时手动安装

以下示例是 Linux x86_64 的 **systemd 手动安装**。先下载与核对，再改动系统，不使用 `curl | sh`。

```sh
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/zdz/ServerStatus-Rust/releases/download/v1.8.1/client-x86_64-unknown-linux-musl.zip \
  -o client.zip
printf '%s  %s\n' \
  aa73a6d1c5e7283fb1cc2f3dbd1a80d4fb0ae8fadd3d5b236a15f32ecf0420a5 \
  client.zip | sha256sum -c -
unzip -p client.zip stat_client > stat_client
sudo install -d -m 755 /opt/nexus-probe
sudo install -m 755 stat_client /opt/nexus-probe/stat_client
sudo install -m 600 /dev/null /etc/nexus-probe.env
sudoedit /etc/nexus-probe.env
```

ARM 机器需替换下载文件和校验值：

| 架构            | 发布文件                                    | SHA-256                                                            |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| aarch64 / arm64 | `client-aarch64-unknown-linux-musl.zip`     | `5bd675976ae8fcfa82b535702be56a9d721142ebf3eb12fa12de8e79448b8bf0` |
| armv7l          | `client-armv7-unknown-linux-musleabihf.zip` | `dfaadfda892181602e96853db30db58d1c8dc26741f37f3b6a871b95559c2085` |

填入环境文件，替换所有示例值。包含引号和反斜杠的值需按 systemd EnvironmentFile 规则转义；不要把该文件当 Shell 脚本执行：

```ini
SSR_ADDR="https://status.example.com/report"
SSR_GID="homelab"
SSR_PASS="REPLACE_WITH_YOUR_GROUP_PASSWORD"
SSR_ALIAS="my-server"
SSR_LOC="cn"
SSR_TYPE="kvm"
SSR_ONLINE="3"
SSR_INTERVAL="3"
```

用 `sudoedit /etc/systemd/system/nexus-probe.service` 写入：

```ini
[Unit]
Description=Nexus ServerStatus-Rust Probe
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=nexus-probe
WorkingDirectory=/var/lib/nexus-probe
EnvironmentFile=/etc/nexus-probe.env
ExecStart=/opt/nexus-probe/stat_client
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now nexus-probe.service
systemctl status nexus-probe.service --no-pager
```

**没有 systemd**：不要运行本自动脚本。下载并核对对应二进制后，使用系统自己的 OpenRC / supervisor 配置持久的工作目录与上述环境变量，再以受限用户启动 `/opt/nexus-probe/stat_client`。工作目录中的 `.server_status_sys_id` 必须可写并保留，否则重启后节点 ID 可能变化。OpenRC、NAS 专有系统和 Windows 探针服务托管当前未自动化，按上游与系统厂商说明处理。

## 接入 Nexus

1. 「探针与连接」→ 数据接口填 `https://status.example.com/json/stats.json`。
2. 公开 JSON 通常不需要 Token；若反向代理要求 Bearer Token，填写桌面接口 Token。
3. 点击「保存并连接」，选节点，导入所选设备。
4. 编辑设备，填写连接 IP / 域名、SSH 用户、端口和认证。探针的公共 JSON 不公开这些连接信息。
5. 使用节点稳定 `name` 绑定；修改 `alias` 不会解绑。卸载 / 重装时保留系统 ID 文件。

仅用于受信任私有网络时可以手动把 `SSR_ADDR` 改成 HTTP；HTTP 会明文传输上报凭据，公网必须使用 HTTPS。桌面轮询读取地址与上报地址完全独立。

## 排障与卸载

```sh
systemctl status nexus-probe.service --no-pager
sudo journalctl -u nexus-probe -n 50 --no-pager
```

- **运行但没有节点**：核对 `/report`、分组 ID / 密码及服务端 `hosts_group`；不要用桌面接口 URL 代替上报地址。
- **HTTPS 失败**：核对证书、系统时间与 CA 包，不用 `curl -k` 或关闭 TLS 验证。
- **SSH 无法登录**：探针和 SSH 是两个服务，探针在线不代表 SSH 可用。
- **数据过期**：检查客户端日志和服务端 `updated`，Nexus 不把旧值冒充在线。
- **日志安全**：不要打开上游 debug 后公开粘贴全部日志；配置 / 环境中含密码。公开 Issue 前自行脱敏。

从仓库执行 `sudo sh scripts/probe/uninstall.sh` 会先确认，再停止服务、移除本脚本安装的 unit 与二进制。配置和节点身份**始终保留**，不做递归删除。若需要彻底清理，先备份并核对路径，再由管理员自行处理。
