#!/bin/bash
# Nav 导航站 - MySQL 初始化脚本 (在 WSL2 中运行)
set -e

ROOT_PASS="Pa12-/11"
DB_NAME="navdb"
DB_USER="navuser"
DB_PASS="navuser123"

echo "=== 创建数据库和用户 ==="

sudo mysql -u root -p"${ROOT_PASS}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP USER IF EXISTS '${DB_USER}'@'%';
DROP USER IF EXISTS '${DB_USER}'@'localhost';

CREATE USER '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASS}';
CREATE USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';

GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "✓ 数据库和用户已创建"

echo ""
echo "=== 建表 + 初始数据 ==="

sudo mysql -u root -p"${ROOT_PASS}" "${DB_NAME}" <<SQL
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  title VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  description TEXT,
  icon_url TEXT,
  clicks INT DEFAULT 0,
  is_private TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 清理旧数据
DELETE FROM links;
DELETE FROM categories;
ALTER TABLE categories AUTO_INCREMENT = 1;
ALTER TABLE links AUTO_INCREMENT = 1;

-- 默认数据
INSERT INTO categories (name, sort_order) VALUES ('常用推荐', 0);
INSERT INTO categories (name, sort_order) VALUES ('工作学习', 1);
INSERT INTO links (category_id, title, url, description) VALUES (1, 'Google', 'https://www.google.com', '搜索引擎');
INSERT INTO links (category_id, title, url, description) VALUES (1, 'GitHub', 'https://github.com', '代码托管平台');
INSERT INTO links (category_id, title, url, description) VALUES (2, 'Stack Overflow', 'https://stackoverflow.com', '技术问答');
SQL

echo "✓ 表结构和默认数据已导入"
echo ""
echo "🎉 数据库初始化完成!"
echo ""
echo "测试连接:"
mysql -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" -e "SELECT COUNT(*) AS categories_count FROM categories; SELECT COUNT(*) AS links_count FROM links;"
