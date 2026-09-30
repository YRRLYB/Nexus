# ServerStatus 数据接口

Nexus 读取 ServerStatus-Rust 的 `/json/stats.json`，不运行探针客户端二进制，也不提供服务端。探针客户端向 `/report` 上报，两者使用不同接口与凭据。

## 字段

| Nexus    | ServerStatus 字段与处理                                    |
| -------- | ---------------------------------------------------------- |
| 绑定 ID  | `name`；分组模式使用客户端持久化的系统 ID                  |
| 展示名称 | `alias`，缺省使用 `name`                                   |
| 在线     | `online4` 或 `online6`，并检查 `updated` 与 `latest_ts`    |
| CPU      | `cpu`，百分比                                              |
| 内存     | `memory_used / memory_total`，计数乘 1024 转字节           |
| 磁盘     | `hdd_used / hdd_total`；默认乘 1024²，`si=true` 时乘 1000² |
| 系统     | 从 `labels` 解析 `os=...`，不当作完整发行版信息            |
| 运行时间 | 服务端的 `uptime`                                          |
| 网络     | `network_rx`、`network_tx`，字节每秒                       |
| 延迟     | `time_10010`，探针至联通探测点的延迟，不是桌面至服务器延迟 |

公共 JSON 不提供 SSH 登录信息，需要在设备中单独填写。缺失计数显示未知，不作为 0 处理。接口 Bearer Token 与探针分组密码分开保存。

## 读取策略

默认每 10 秒轮询，可设置为 5–300 秒。请求超时 12 秒，最大响应 5 MB，不跟随重定向。默认过期阈值 90 秒，可调整为 30–3600 秒。

接口异常时保留设备配置，但清空当前监控快照，避免显示旧数据为实时数据。单个节点过期则标记离线。重启跟踪必须观察到离线后重新上线才确认完成。

字段处理参考固定版本 v1.8.1 的 [payload](https://github.com/zdz/ServerStatus-Rust/blob/v1.8.1/server/src/payload.rs)、[stats](https://github.com/zdz/ServerStatus-Rust/blob/v1.8.1/server/src/stats.rs) 与 [客户端](https://github.com/zdz/ServerStatus-Rust/blob/v1.8.1/client/src/sys_info.rs)。
