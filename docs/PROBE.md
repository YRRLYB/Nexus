# 探针研究记录

研究日期：2026-09-19。输入：`serverstatus-agent-private-linux-amd64-v1.8.1.zip`。

## 包内容及方向

| 文件                          | 用途                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `bin/stat_client-linux-amd64` | ServerStatus-Rust 1.8.1 静态链接 Linux x86_64 客户端  |
| `install.sh`                  | 校验二进制、交互配置、安装 systemd unit               |
| `systemd/stat_client.service` | 通过受限权限的环境文件提供认证参数                    |
| `defaults.private.env`        | 私有默认配置，含上报凭据，不进入 Nexus 源码或发布产物 |
| `status.sh` / `uninstall.sh`  | 诊断与卸载，卸载前归档配置与节点 ID                   |

本机为 Windows，未执行 Linux 二进制或部署脚本，也未修改任何服务器。只读取公开状态 JSON 和对应版本的上游源码。

客户端上报地址与桌面读取地址属于不同接口。Nexus 无需运行该 Linux 二进制，只负责把现有监控数据绑定到自己的设备模型。

## 接口与字段

已实际读取部署包说明中的 `https://server.yrrlyb.top/json/stats.json`，获得 `updated` 与 `servers` 数组，首次读取有 6 个节点。节点数随服务端变化，不在产品中固定。

参考上游固定版本：

- <https://github.com/zdz/ServerStatus-Rust/blob/v1.8.1/server/src/payload.rs>
- <https://github.com/zdz/ServerStatus-Rust/blob/v1.8.1/server/src/stats.rs>
- <https://github.com/zdz/ServerStatus-Rust/blob/v1.8.1/client/src/sys_info.rs>

| Nexus       | ServerStatus 字段 / 处理                                                  |
| ----------- | ------------------------------------------------------------------------- |
| 稳定绑定 ID | `name`；分组模式中对应客户端持久化的系统 ID                               |
| 名称        | `alias`，缺省用 `name`                                                    |
| 在线        | `(online4 === true                                                        |     | online6 === true)`，同时检查 `updated`和`latest_ts` |
| CPU         | `cpu`，百分比                                                             |
| 内存占用    | `memory_used / memory_total * 100`，计数乘 1024 转字节                    |
| 磁盘占用    | `hdd_used / hdd_total * 100`，默认计数乘 1024² 转字节；`si=true` 用 1000² |
| 系统类别    | 从 `labels` 解析 `os=...`；不是完整发行版版本                             |
| 运行时间    | `uptime` 已是服务端格式化字符串                                           |
| 网络速率    | `network_rx` / `network_tx`，字节每秒                                     |
| 延迟        | `time_10010`，探针至中国联通探测点的延迟，不是本机到服务器延迟            |
| SSH IP      | 不在该公共 JSON 中暴露，必须自行填写                                      |

上游 `ip_info` 和 `sys_info` 标为 `skip_serializing`。不能把布尔字段 `si` 误当成系统信息对象。缺失计数显示 `—`，不伪造为 0。

## 连接失败策略

主进程每 10 秒轮询（可配置 5–300 秒）。请求超时 12 秒，最大响应 5 MB，不跟随重定向。默认 90 秒过期阈值，可调整至 30–3600 秒。接口整体过期视为读取失败；单个节点过期则视为离线。接口异常时清空当前监控快照，保留设备配置，避免旧值冒充实时数据。

接口 Bearer Token 如需配置则加密保存，与探针客户端分组密码完全分开。普通公开 ServerStatus JSON 无需 Token。
