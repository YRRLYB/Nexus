# Nexus 项目方案

> **Nexus —— 可视化的个人服务器与 Linux 设备管理平台**
>
> 第一阶段不追求“大而全”，只解决个人开发者在管理多台无桌面 Linux 服务器时最繁琐的问题。

---

## 1. 项目概述

Nexus 的核心不是重新制作一个传统 SSH 客户端，而是把个人拥有的服务器设备统一放进一个**可视化、可管理的桌面空间**。

用户打开 Nexus 后，可以看到自己添加的服务器设备：

```text
┌─────────────────────────────────────────────────────────────┐
│ Nexus                                             ＋ 添加设备 │
│                                                             │
│          ☁ Tokyo VPS                    ☁ Singapore VPS     │
│                                                             │
│                         ☁ Minecraft                        │
│                                                             │
│             ☁ Bot Server                         ☁ Web      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

每台服务器都是一个可以自由拖动、排列的设备节点。

点击设备后，可以直接查看：

- 在线 / 离线状态
- CPU 占用
- 内存占用
- 磁盘占用
- 系统版本
- IP 地址
- SSH 端口
- 用户名
- 运行时间
- 其他来自现有网络探针的数据

并可以直接执行：

- SSH 连接
- SFTP 文件管理
- 复制 IP / 用户名 / 密码 / SSH 命令
- 重启
- 关机
- 常用远程命令

---

# 2. 为什么要做 Nexus

当前个人管理服务器的典型方式往往比较分散：

```text
TXT / Excel
    ↓
保存 IP、用户名、密码

SSH 客户端
    ↓
连接服务器

FileZilla
    ↓
管理服务器文件

探针 / 网页
    ↓
查看服务器状态

终端
    ↓
重启、查看日志、执行命令
```

尤其对于**无桌面的 Linux 服务器**，操作过程比拥有完整桌面的设备更加繁琐。

因为服务器没有：

- 桌面文件管理器
- 图形化系统设置
- 图形化任务管理器
- 图形化服务管理
- 本地桌面上的重启按钮
- 直观的系统状态界面

很多操作都必须依赖 SSH：

```text
ssh
→ 执行命令
→ 查看输出
→ 判断状态
→ 再执行下一条命令
```

因此 Nexus 的核心价值不是“帮用户连上 SSH”，而是：

> **把原本分散在 SSH、FileZilla、TXT、探针和命令行里的服务器管理流程，整合到一个统一的设备界面中。**

---

# 3. 第一阶段的产品定位

第一阶段不定义为：

> 全能服务器管理平台

也不定义为：

> 企业级运维系统

而定义为：

> **个人服务器管理工作台**

核心用户就是项目开发者本人以及拥有多台 VPS / Linux Server 的个人用户。

第一阶段只解决几个真实问题：

### 问题 A：服务器信息难找

原本：

```text
打开 TXT
↓
寻找服务器名称
↓
复制 IP
↓
寻找用户名
↓
寻找密码
```

Nexus：

```text
点击服务器
↓
所有信息集中显示
```

### 问题 B：SSH 操作繁琐

原本：

```text
打开终端
↓
输入 ssh 命令
↓
输入密码
```

Nexus：

```text
点击设备
↓
SSH
```

### 问题 C：传文件需要单独打开 FileZilla

Nexus：

```text
点击设备
↓
Files
↓
直接进行 SFTP 文件管理
```

### 问题 D：无桌面 Linux 不容易查看状态

Nexus：

```text
点击设备
↓
直接查看：
CPU / RAM / Disk / OS / Uptime / Online
```

### 问题 E：重启需要记命令

Nexus：

```text
Restart
↓
确认
↓
执行
```

---

# 4. 最核心的产品体验

Nexus 的使用流程应该尽量接近：

```text
打开 Nexus
    ↓
看到所有设备
    ↓
点击一个设备
    ↓
查看当前状态
    ↓
选择需要执行的操作
```

而不是：

```text
寻找 IP
→ 找用户名
→ 找密码
→ 打开 SSH
→ 输入命令
→ 再打开 FileZilla
→ 再查看监控
```

---

# 5. 主界面设计

## 5.1 设计方向

整体使用：

- 纯白 / 极浅灰背景
- 大量留白
- 简洁的黑色文字
- 少量状态色
- 轻量阴影
- 圆角设备卡片
- 极简图标
- 避免传统服务器管理软件的深蓝、赛博朋克和高密度表格风格

目标感觉更接近：

- Apple
- Linear
- Figma
- Arc

而不是传统运维控制台。

---

## 5.2 可视化设备画布

设备不是固定排列的列表，而是自由放置的节点。

例如：

```text
                         ☁ Tokyo VPS


          ☁ Bot Server


                              🗄 NAS


      ☁ Singapore VPS                     🖥 Main PC
```

用户可以：

- 拖动设备
- 自由排列
- 自定义设备名称
- 自定义图标
- 添加标签
- 添加备注
- 删除设备
- 保存布局

第一阶段不要求自动生成真实网络拓扑。

设备之间的连接关系可以留到后续版本。

---

# 6. 设备模型

所有设备统一抽象为 `Device`。

```text
Device
├── Identity
├── Connection
├── Credential
├── Probe
├── Metrics
├── Actions
└── Files
```

第一阶段主要设备类型：

```text
Linux Server
Linux VPS
Windows PC
macOS
NAS
```

但是开发重点：

> **无桌面 Linux Server / VPS**

---

# 7. 无桌面 Linux 是 Nexus 的重点

Nexus 第一阶段应该明显围绕 Headless Linux 的使用方式设计。

因为无桌面 Linux 的特点是：

```text
没有图形界面
↓
所有维护操作高度依赖 SSH
↓
命令行成为主要控制方式
```

因此 Nexus 不需要把 Linux “变成桌面”。

而应该：

> **把常用命令行运维能力提炼成可视化操作。**

例如：

```text
Tokyo VPS

● Online
Ubuntu 24.04

CPU       18%
Memory    42%
Storage   63%

[ SSH ]
[ Files ]
[ Restart ]

Quick Actions
[ Docker ]
[ Services ]
[ Logs ]
```

---

# 8. 设备详情页

建议采用右侧抽屉 / 面板，而不是跳转到完全独立的页面。

```text
┌──────────────────────────────┬──────────────────────────────┐
│                              │ Tokyo VPS                    │
│                              │ ● Online                     │
│                              │                              │
│                              │ Ubuntu 24.04                 │
│                              │                              │
│                              │ CPU                          │
│                              │ █████░░░░░ 18%               │
│                              │                              │
│                              │ Memory                       │
│                              │ ███████░░░ 42%               │
│                              │                              │
│                              │ Storage                      │
│                              │ ████████░░ 63%               │
│                              │                              │
│                              │ IP                           │
│                              │ 1.2.3.4             [复制]  │
│                              │                              │
│                              │ Username                     │
│                              │ root                 [复制]  │
│                              │                              │
│                              │ [ SSH ] [ Files ]            │
│                              │ [ Restart ]                  │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

用户始终能够看到设备画布。

---

# 9. 网络探针系统

用户已有自己的网络探针系统，因此 Nexus 不需要重新开发一套完整的监控采集方案。

Nexus 将现有探针视为自己的数据来源之一。

探针可以提供：

```text
Online
CPU
Memory
Disk
OS
Network
IP
Latency
Uptime
其他指标
```

Nexus 负责：

```text
接收
→ 整理
→ 展示
→ 与设备绑定
```

核心原则：

> **Probe 负责“感知设备”，Nexus 负责“管理设备”。**

这样可以避免 Nexus 第一阶段陷入监控系统开发。

---

# 10. SSH

SSH 是第一阶段的核心功能。

建议第一版直接使用系统 OpenSSH，而不是自己实现 SSH 协议。

流程：

```text
用户点击设备
    ↓
SSH
    ↓
读取该设备连接配置
    ↓
调用本机 SSH
    ↓
连接服务器
```

最终可以直接形成：

```bash
ssh root@1.2.3.4 -p 22
```

第一阶段可以直接调用系统终端。

以后再考虑开发内嵌终端。

---

# 11. SFTP 文件管理

Nexus 内置远程文件管理能力。

第一阶段定位：

> **够用即可，不追求复刻完整 FileZilla。**

核心操作：

- 浏览目录
- 上传
- 下载
- 拖拽上传
- 删除
- 重命名
- 创建文件夹
- 文件大小
- 文件权限
- 刷新

界面：

```text
Local                         Remote

C:\Projects                   /home/bot
────────────────────────────────────────

📁 bot                        📁 bot
📁 website                    📁 docker
📄 test.py                    📄 compose.yml
📄 config.json                📄 README.md
```

优先支持 SFTP。

---

# 12. 快速复制

这是 Nexus 第一阶段最直接解决个人痛点的功能之一。

设备菜单：

```text
Copy
├── IP
├── Port
├── Username
├── Password
├── SSH Command
└── Full Device Info
```

例如：

### Copy IP

```text
1.2.3.4
```

### Copy SSH Command

```bash
ssh root@1.2.3.4 -p 22
```

### Copy Full Info

```text
Tokyo VPS
Ubuntu 24.04
IP: 1.2.3.4
Port: 22
User: root
```

---

# 13. 凭据管理

原有 TXT 中的：

```text
IP
Username
Password
```

迁移进 Nexus 后，不应该直接保存成普通明文 JSON。

设计为本地凭据库：

```text
Nexus Vault
├── Tokyo VPS
├── Singapore VPS
├── Bot Server
└── Minecraft Server
```

敏感字段：

- Password
- SSH Private Key
- Token
- 其他认证信息

应该尽可能交给操作系统的安全凭据系统保存。

例如：

```text
Windows Credential Manager
macOS Keychain
Linux Secret Service
```

Nexus 数据库只保留设备配置与非敏感元数据。

---

# 14. 重启 / 关机

第一阶段可以提供两个最基础的远程操作：

```text
Restart
Shutdown
```

Linux 服务器：

```text
Restart
↓
二次确认
↓
通过 SSH 执行对应命令
↓
等待设备重新上线
```

操作完成之后可以通过探针确认：

```text
Offline
    ↓
Restarting
    ↓
Online
```

这样会形成一个完整的闭环。

---

# 15. Quick Actions

针对无桌面 Linux，后续可以逐步增加一些非常高频、但不需要用户自己记命令的操作。

例如：

```text
Quick Actions

[ Restart ]
[ Shutdown ]

[ Docker ]
[ Services ]
[ Logs ]
[ Update ]
```

这里不要一开始做几十项。

只在实际使用 Nexus 的过程中，记录自己反复执行的命令，然后逐渐把这些操作变成快捷按钮。

---

# 16. 设备状态

设备卡片不需要展示大量数据。

首页只显示：

```text
● Online
```

或者：

```text
○ Offline
```

可以附带非常少量信息：

```text
Tokyo VPS
● Online
Ubuntu 24.04
CPU 18%
RAM 42%
```

点击后再查看完整信息。

这样画布始终保持干净。

---

# 17. 数据结构建议

设备配置可以抽象为：

```json
{
  "id": "tokyo-vps",
  "name": "Tokyo VPS",
  "type": "linux-server",
  "icon": "server",
  "position": {
    "x": 420,
    "y": 180
  },
  "connection": {
    "host": "1.2.3.4",
    "port": 22,
    "username": "root"
  },
  "probe": {
    "enabled": true,
    "device_id": "tokyo-vps"
  },
  "capabilities": {
    "ssh": true,
    "sftp": true,
    "restart": true,
    "shutdown": true
  }
}
```

密码和私钥不直接放入这个 JSON。

---

# 18. “设备能力”设计

不要默认所有设备都拥有完全相同的功能。

例如：

```text
Linux VPS
├── SSH
├── SFTP
├── Restart
├── Shutdown
└── Probe
```

Windows PC：

```text
Windows PC
├── Probe
├── Power
└── Remote Desktop（未来）
```

NAS：

```text
NAS
├── Files
├── Web
└── Restart
```

因此设备模型应该具有：

```text
Capabilities
```

根据设备能力动态生成 UI。

---

# 19. 第一阶段明确不做的东西

为了避免项目重新变成“大而全”，以下功能第一阶段暂不考虑：

- AI Agent
- MCP
- 自动网络拓扑分析
- 企业级监控
- Kubernetes
- 多人协作
- 云端同步
- 多租户
- 复杂权限系统
- 全协议 FTP 管理
- RDP
- VNC
- 3D 网络地图
- 自动发现整个局域网
- 复杂 Docker 编排
- 复杂日志分析

这些都可以以后再考虑。

---

# 20. MVP 范围

## Nexus v0.1

只完成以下功能：

### 设备

- 添加设备
- 编辑设备
- 删除设备
- 自定义名称
- 自定义图标
- 自由拖动
- 自动保存布局

### 连接

- SSH
- SFTP

### 状态

- Online / Offline
- CPU
- Memory
- Storage
- OS
- Uptime

以上状态直接接入已有探针。

### 操作

- Copy IP
- Copy Username
- Copy Password
- Copy SSH Command
- Restart
- Shutdown

### 安全

- 本地设备数据库
- 系统安全凭据保存

做到这里，第一版就可以真正投入自己的日常使用。

---

# 21. 推荐开发顺序

## Phase 1：设备画布

先做：

```text
白色 UI
↓
画布
↓
添加设备
↓
设备卡片
↓
拖动
↓
保存位置
```

目标：

> 打开 Nexus，就能看到自己的所有服务器。

---

## Phase 2：设备详情

加入：

```text
设备信息
CPU
RAM
Disk
OS
IP
```

并接入自己的探针。

---

## Phase 3：SSH

实现：

```text
设备
↓
SSH
↓
直接连接
```

完成后 Nexus 就已经有实际使用价值。

---

## Phase 4：SFTP

加入：

```text
Files
↓
远程目录
↓
上传 / 下载
```

逐步替代 FileZilla 的高频需求。

---

## Phase 5：快捷操作

加入：

```text
Restart
Shutdown
Copy
Quick Actions
```

至此基本完成最初目标。

---

# 22. 后续自然生长方向

第一版投入实际使用以后，再观察自己最常做什么。

例如发现自己经常：

```text
docker ps
docker logs
systemctl status
journalctl
df -h
htop
tail -f
```

那么再把这些操作逐步抽象成：

```text
Services
Docker
Logs
Terminal Tools
Quick Commands
```

这样功能不是凭空设计出来的，而是：

> **从实际使用习惯中自然生长。**

---

# 23. 最终愿景

Nexus 最终不是：

> “又一个 SSH 客户端。”

而是：

> **把个人拥有的服务器和设备，变成一个可以直观看见、点击并操作的数字空间。**

但第一阶段不需要实现全部愿景。

第一阶段只需要做到：

```text
TXT
 +
SSH
 +
FileZilla
 +
探针
 +
常用命令
```

被 Nexus 统一起来。

最终使用体验应该是：

```text
打开 Nexus
    ↓
看到所有服务器
    ↓
点击 Tokyo VPS
    ↓
查看：
● Online
CPU 18%
RAM 42%
Disk 63%
Ubuntu 24.04
    ↓
[ SSH ] [ Files ] [ Restart ]
    ↓
完成操作
```

这就是 Nexus v0.1 的核心。

---

# 24. 项目一句话

> **Nexus — A visual workspace for managing your personal servers and devices.**

中文：

> **Nexus —— 一个把个人服务器与设备集中到可视化空间中进行管理的开源平台。**

---

# 25. 核心原则

整个项目在开发过程中始终遵守三个原则：

### 1. 先解决自己的问题

不为了“功能丰富”而增加功能。

### 2. 设备优先，功能其次

用户看到的是：

> **我的服务器**

而不是：

> SSH / SFTP / Monitor / Terminal 等零散工具。

### 3. 无桌面 Linux 优先

因为这是最符合项目实际使用场景的设备类型，也是 Nexus 最容易体现价值的地方。

---

## 当前建议的项目定位

**Project Name：** `Nexus`

**Category：** Desktop Application / Infrastructure Management

**Primary Platform：** Windows

**Primary Device Type：** Headless Linux Server / VPS

**Core Protocols：** SSH / SFTP

**Monitoring Source：** Existing Personal Probe System

**UI：** White / Minimal / Visual Canvas

**Target：** Personal Developers / Homelab Users / VPS Users
