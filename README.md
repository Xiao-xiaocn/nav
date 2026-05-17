# nav导航站
一个私人的导航网站，可服务器node部署，也可cloudflare 
---
## 服务器node部署(环境要求node+MySQL)
### 1、拉取该项目到本地
### 2、安装依赖
`npm install`
### 3、配置.env(环境变量)
#### 启用.env
把.env.example改为.env
#### 参数说明
```
# MySQL服务器地址
DB_HOST=::1
# MySQL服务器端口
DB_PORT=3306
# MySQL用户名
DB_USER=navuser
# MySQL密码
DB_PASSWORD=navuser123
# MySQL数据库名
DB_NAME=navdb
# 前端管理员密码
ADMIN_PASSWORD=123456

# --- 后端端口 ---
# Express 服务器监听端口
PORT=3001
```
## CloudFlare部署
详见[CloudFlare部署教程](https://github.com/Xiao-xiaocn/nav/blob/main/CloudFlare/Cloudflare%20Workers.md)
