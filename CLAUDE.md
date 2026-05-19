# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个私人导航网站（链接收藏/书签管理），支持 Node.js + MySQL 部署和 Cloudflare Workers + D1 部署两种模式。单一 HTML 前端页面，使用 Alpine.js 驱动。

## 常用命令

```bash
# 安装依赖
npm install

# 启动服务器（需先配置 .env 和初始化数据库）
npm start              # 等同于 node server.js

# 初始化/重置数据库（需要 root 密码，在 .env 中设 DB_ROOT_PASSWORD）
npm run setup          # 等同于 node setup-db.js

# Windows 快速启动
start.bat
```

## 环境变量（.env）

复制 `.env.example` 为 `.env`，配置项：

| 变量 | 说明 |
|------|------|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 连接信息 |
| `ADMIN_PASSWORD` | 前端管理员登录密码 |
| `PORT` | Express 监听端口（默认 3001） |
| `DB_ROOT_PASSWORD` | MySQL root 密码（仅 `npm run setup` 时需要，用后可删除） |

## 架构

```
server.js              → Express 入口，静态文件 + API 路由挂载
routes/api.js          → 全部 REST API（见下方 API 表）
db.js                  → MySQL 连接池（mysql2/promise）
setup-db.js            → 自动创建数据库、用户、表、种子数据
init-db.sql            → MySQL schema（categories + links 两张表）
public/index.html      → 完整前端 SPA（Alpine.js + Tailwind CDN + Sortable.js）
CloudFlare/
  Worker.js            → Cloudflare Workers 版本（含内联 HTML，D1 数据库）
  nav.sql              → D1 兼容的 SQLite schema
  Cloudflare Workers.md → Cloudflare 部署教程
```

### API 路由 (`/api`)

所有写操作需要 `Authorization` header 等于 `ADMIN_PASSWORD`。

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/data` | 否 | 获取全部分类 + 链接（未认证隐藏私有链接） |
| POST | `/login` | 否 | 密码登录，有 IP 限流（10次/分钟） |
| GET | `/export` | 是 | 导出 JSON 备份 |
| POST | `/import` | 是 | 导入 JSON 恢复（事务性替换全部数据） |
| POST | `/sort` | 是 | 批量更新分类或链接排序 `{ type, ids }` |
| POST/PUT/DELETE | `/category` | 是 | 分类 CRUD |
| POST/PUT/DELETE | `/link` | 是 | 链接 CRUD（新增链接自动获取 DuckDuckGo favicon） |
| PUT | `/link/move` | 是 | 链接跨分类移动 |

### 数据库

两张表，`links.category_id` 外键关联 `categories.id`（CASCADE 删除）。

### 认证方式

简单的 password-in-header 方案：前端将 `ADMIN_PASSWORD` 存入 `localStorage.nav_token`，每次请求通过 `Authorization` header 发送。无 JWT、无 session、无过期。Cloudflare Workers 版本逻辑相同。

### 前端

单个 `public/index.html`，使用 CDN 加载 Tailwind CSS、Alpine.js 和 Sortable.js。管理模式下启用拖拽排序（Sortable），支持分类间拖动链接。支持浅色/深色/自动主题切换。图标优先使用自定义 URL，其次通过 api.iowen.cn 获取 favicon。
