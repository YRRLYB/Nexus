# 在服务器上部署软件

## 软件内安装

在 Linux 设备详情中点击「部署软件」，选择 Docker、宝塔面板或 ServerStatus 探针。

1. 保存 SSH 认证信息，确认目标提供 SFTP 子系统。SFTP 用于上传安装脚本。
2. 点击「检查环境并加载脚本」。这一步只读取系统信息，安装脚本由 Nexus 下载或从应用中读取，不更改服务器。
3. 查看发行版、架构、当前用户、脚本来源和 SHA-256。展开「查看将要执行的脚本」检查内容。
4. 勾选确认后点击安装，再核对目标地址。确认在 5 分钟后过期，过期需重新检查。
5. 安装日志显示在终端中。有 sudo、密码或继续安装提示时，直接在终端操作。不会自动向所有提示回答 yes。

确认执行的是这次预览的脚本，不会在点击安装后重新下载入口脚本。第三方脚本继续下载的软件包、依赖和子脚本不在预览范围内，显示哈希也不等于数字签名。

每台设备同时只允许一个安装任务。收起窗口不停止任务，重新打开可查看结果；应用退出后连接会关闭，远程后台进程不一定结束。

## 安装来源和范围

| 软件              | 来源                                                   | 部署入口要求                                                                                     |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Docker            | `https://get.docker.com`，官方便利脚本                 | Debian、Ubuntu、Fedora、CentOS、RHEL、Rocky、AlmaLinux；x86_64、ARM64、ARMv7                     |
| 宝塔面板          | `https://download.bt.cn/install/installStable_12.sh`   | Debian 11 及以上、Ubuntu 20.04 / 22.04 / 24.04 LTS，或 CentOS / Rocky / AlmaLinux；x86_64、ARM64 |
| ServerStatus 探针 | 应用内的 `scripts/probe/install.sh`，固定客户端 v1.8.1 | Linux、systemd；x86_64、ARM64、ARMv7；需 curl、unzip、sha256sum                                  |

这些是 Nexus 入口的检查范围，不是所有系统版本的兼容承诺。发行版已停止维护、官方源不可达或安装脚本拒绝当前版本时，安装仍会失败。以目标服务器与上游支持说明为准。

安装需要 root，或可交互使用 sudo 的用户，以及 bash。不会替用户开放 root 登录或修改 sudo 权限。Docker、宝塔或探针已存在时，此入口拒绝覆盖；探针也会避开正在运行的 `stat_client.service`。

Docker 便利脚本会配置软件源并安装组件，官方不推荐把它作为生产环境的常规维护方式。宝塔面板会修改软件包、服务和防火墙，并可能要求创建或绑定宝塔账号；建议使用干净系统，安装后检查面板入口和防火墙规则。Nexus 不保存面板登录资料，也不自动替你登录面板。

探针需要已有服务端，表单填写 HTTPS `/report` 地址、组 ID、节点名称和地区代码。组密码在终端中隐藏输入。没有自动部署的环境可使用 [手动安装教程](PROBE-INSTALL.md)。

## 结果与中断

安装脚本成功退出后，还需要通过对应检查，才显示完成：

- Docker：能够读取 Docker 服务端版本。
- 宝塔：面板文件、端口配置存在，且面板进程运行。
- 探针：`nexus-probe.service` 已启用且运行。服务启动不代表服务端认证成功，还需在状态页核对上报。

验证与安装在同一权限环境执行，避免 sudo 的终端认证在新连接中失效。脚本异常退出、连接中断或验证失败都不会显示安装成功。

「中断安装」发送中断请求后关闭连接，不执行卸载，也不能保证子进程已结束。软件包、配置和防火墙改动可能已经生效；需要登录服务器检查。再次安装前先确认包管理器和原安装进程已停止。

脚本暂存在服务器的 `/tmp/nexus-deploy.*` 目录，正常结束后移除入口脚本。网络断开或第三方脚本生成其他文件时，目录可能保留。Nexus 不自动递归删除未知的第三方文件。

## 在终端手动安装 Docker

仓库中的 `scripts/install-docker.sh` 可用于手动安装。Debian / Ubuntu / Fedora 等使用官方脚本，Alpine 使用发行版的软件包和 OpenRC。已有 Docker 时只读取版本，不升级。

```sh
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/YRRLYB/Nexus/main/scripts/install-docker.sh \
  -o nexus-docker-install.sh
less nexus-docker-install.sh
sh nexus-docker-install.sh --dry-run
sudo sh nexus-docker-install.sh
```

不要直接在专有 NAS 系统上运行通用安装脚本。网络、代理和软件源配置由服务器管理员负责，Nexus 不自动改用不明镜像。

参考：[Docker 安装说明](https://docs.docker.com/engine/install/)、[Docker 便利脚本](https://github.com/docker/docker-install)、[宝塔下载页](https://www.bt.cn/new/download.html)。
