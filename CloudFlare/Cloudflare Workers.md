这份部署指南已为你改写为纯 Cloudflare 网页控制台（Dashboard）的部署教程。无需安装 Node.js、无需配置本地 Wrangler 环境，直接在浏览器中即可完成全部部署。

* * *

# Cloudflare Worker + D1 导航站 网页端部署指南

本教程将指引你通过 Cloudflare 网页后台，在线创建 D1 数据库并部署 Worker 导航页。

## 第一步：创建并初始化 D1 数据库

1.  登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
    
2.  点击左侧导航栏的 **Workers & Pages (Workers 和 Pages)** -> **D1**。
    
3.  点击 **创建 (Create)** -> **创建数据库 (Create database)**。
    
4.  输入数据库名称：`my-nav-db`，点击 **创建 (Create)**。
    
5.  进入刚创建的数据库管理页面，切换到 **控制台 (Console)** 选项卡。
    
6.  将以下 SQL 初始化语句粘贴到输入框中，并点击 **执行 (Execute)**：
    

SQL

```
-- 分类表
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- 链接表
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  clicks INTEGER DEFAULT 0,
  is_private INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初始数据
INSERT INTO categories (name, sort_order) VALUES ('常用推荐', 0);
INSERT INTO categories (name, sort_order) VALUES ('工作学习', 1);
INSERT INTO links (category_id, title, url, description) VALUES (1, 'Google', 'https://www.google.com', '搜索引擎');
```

* * *

## 第二步：创建 Worker 并粘贴代码

1.  点击左侧导航栏的 **Workers & Pages (Workers 和 Pages)** -> **概述 (Overview)**。
    
2.  点击 **创建 (Create)** -> **创建 Worker (Create Worker)**。
    
3.  修改 Worker 的名称（例如 `my-nav`），点击 **部署 (Deploy)**。
    
4.  部署成功后，点击 **编辑代码 (Edit code)** 进入在线编辑器。
    
5.  清空左侧代码文件（通常是 `index.js` 或 `worker.js`）中的所有默认内容，将下面的**完整代码**粘贴进去：
    **代码**[Worker.js](https://github.com/Xiao-xiaocn/nav/blob/main/CloudFlare/Worker.js)
    

JavaScript



6.  点击右上角的 **保存并部署 (Save and deploy)**。
    

* * *

## 第三步：绑定 D1 数据库与配置环境变量

代码虽然部署了，但此时还无法连接数据库。我们需要在网页端完成绑定：

1.  点击编辑器左上角的项目名称（或返回到该 Worker 的主控制面板）。
    
2.  切换到 **设置 (Settings)** 选项卡。
    

### 1\. 绑定 D1 数据库

* 在左侧菜单点击 **变量 (Variables)**。
  
* 向下滚动到 **D1 数据库绑定 (D1 Database Bindings)** 区域，点击 **添加绑定 (Add binding)**。
  
* **变量名称 (Variable name)** 严格填写：`DB`
  
* **D1 数据库 (D1 database)** 选择：`my-nav-db`
  
* 点击 **保存 (Save)**。
  

### 2\. 配置管理员密码

* 向上滚动到 **环境变量 (Environment Variables)** 区域，点击 **添加变量 (Add)**。
  
* **变量名称 (Variable name)** 填写：`ADMIN_PASSWORD`
  
* **值 (Value)** 填写：`你自定义的登录密码`（例如 `123456`）
  
* 点击 **保存并部署 (Save and deploy)**。
  

* * *

## 第四步：访问与数据导入

1.  返回 Worker 的 **概述 (Overview)** 页面。
    
2.  在 **访问 (Visit)** 区域会看到 Cloudflare 为你自动分配的 `*.workers.dev` 域名。
    
3.  点击链接即可打开导航站！
    
