# 安装 Nexus 与常用服务器工具

## 安装 Nexus 桌面程序

Nexus 是 **Windows 桌面应用**，不是要部署到每一台服务器的网站，也不需要在服务器上启动 Docker 容器才能使用。

从仓库的 [Releases](https://github.com/YRRLYB/Nexus/releases) 下载 `Nexus-版本-Windows-x64.exe` 与 `SHA256SUMS.txt`，核对 SHA-256 后双击便携程序。当前未配置代码签名，Windows 可能显示 SmartScreen 提醒；请核对来源和校验值，不要默认信任不明下载。

```powershell
Get-FileHash .\Nexus-0.4.0-Windows-x64.exe -Algorithm SHA256
```

发行版由 GitHub 的版本标签工作流构建。只有正式上传了发行版，Releases 才有可下载文件；源码仓库中不存放 exe。

从源码运行，需要 Node.js 22+（建议 24）与 Git：

```powershell
git clone https://github.com/YRRLYB/Nexus.git
cd Nexus
npm.cmd ci
npm.cmd run dev
```

自行打包：`npm.cmd run package`。产物保存在 `release/`。更新时先退出旧版，再打开新版。数据位于 `%APPDATA%/Nexus/`，更新不会清空数据；凭据绑定当前 Windows 账户，不可把加密数据库当作可移植密码库。

## Docker 一键安装

设备详情的「复制 Docker 安装命令」会生成下面流程的命令。它**只复制**，不会未经确认在服务器执行：下载公开脚本 → 显示脚本 → 用户运行 → 安装前确认 → 官方安装计划 → 再确认 → 启动服务。

先在**目标 Linux 服务器**安装 `curl`。下面两行分别下载和审阅，最后才执行：

```sh
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/YRRLYB/Nexus/main/scripts/install-docker.sh \
  -o nexus-install-docker.sh
less nexus-install-docker.sh
sudo sh nexus-install-docker.sh
```

查看计划但不修改系统：

```sh
sh nexus-install-docker.sh --dry-run
```

已审阅、明确同意无人值守安装时才使用 `sudo sh nexus-install-docker.sh --yes`。root 用户不需要 `sudo`。

### 适用范围

- Debian / Ubuntu / Fedora / CentOS / RHEL / Raspbian 使用 Docker 官方 `get.docker.com` convenience script；实际发行版 / 架构 / 生命周期是否仍受支持由上游脚本判断。
- Alpine 使用 `apk add docker docker-cli-compose`，通过 OpenRC 启动服务。
- 发现现有 Docker 时只显示版本，不覆盖、不自动升级；不自动把用户加入 `docker` 组，不修改防火墙，不开放 Docker 远程 API。
- 官方 convenience script 适合开发 / 测试环境，不建议把它当作生产环境升级策略。生产环境请使用官方仓库的分步安装并锁定版本。
- NAS 厂商系统、Windows 与 macOS 不运行本 Linux 脚本。Windows / macOS 可按官方文档安装 Docker Desktop；NAS 优先使用厂商容器管理器。
- 脚本未在用户的生产服务器实际执行。自动化验证覆盖脚本语法、架构计划与失败边界；实际安装仍需要在自己的测试机器验收。

安装完使用 `sudo docker version` 与 `sudo docker compose version` 验证。Docker daemon 具有高权限，生产环境务必审阅 Docker 官方安全文档。

参考：[官方安装说明](https://docs.docker.com/engine/install/)、[convenience script 与注意事项](https://docs.docker.com/engine/install/debian/#install-using-the-convenience-script)、[官方安装脚本源码](https://github.com/docker/docker-install)。

## 安装同款探针

探针沿用 **ServerStatus-Rust**，无需再开发一套采集协议。查看 [完整探针教程](PROBE-INSTALL.md)：包含自动脚本、无脚本手动安装、systemd、配置权限、排障与卸载。Nexus 读取 `/json/stats.json`，探针向 `/report` 上报，这两个地址不能混淆。

## 发布维护

推送源码时 Windows CI 执行类型检查、测试、格式检查和 Electron UI 测试；Linux CI 校验 Shell 脚本。发布时同步更新 package / lockfile / Changelog，再推送匹配版本的 `v版本号` 标签。发布工作流会生成便携 exe 和 `SHA256SUMS.txt`，测试打包启动后发布到 GitHub Releases。工作流不会上传本机私有探针目录、ZIP、数据库或密码。
