-- Nav 导航站 - MySQL Schema
-- 字符集 utf8mb4 支持 emoji

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
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认数据
INSERT INTO categories (name, sort_order) VALUES ('常用推荐', 0);
INSERT INTO categories (name, sort_order) VALUES ('工作学习', 1);

INSERT INTO links (category_id, title, url, description) VALUES (1, 'Google', 'https://www.google.com', '搜索引擎');
INSERT INTO links (category_id, title, url, description) VALUES (1, 'GitHub', 'https://github.com', '代码托管平台');
INSERT INTO links (category_id, title, url, description) VALUES (2, 'Stack Overflow', 'https://stackoverflow.com', '技术问答');
