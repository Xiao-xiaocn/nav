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