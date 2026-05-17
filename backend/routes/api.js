const express = require('express');
const router = express.Router();
const pool = require('../db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

function isAuth(req) {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  return (authHeader === ADMIN_PASSWORD) || (queryToken === ADMIN_PASSWORD);
}

// GET /api/data - 获取全部分类和链接
router.get('/data', async (req, res) => {
  try {
    const [categories] = await pool.query(
      'SELECT * FROM categories ORDER BY sort_order ASC'
    );
    const auth = isAuth(req);
    const linkSql = auth
      ? 'SELECT * FROM links ORDER BY id DESC'
      : 'SELECT * FROM links WHERE is_private = 0 ORDER BY id DESC';
    const [links] = await pool.query(linkSql);
    res.json({ categories, links, isAuth: auth });
  } catch (err) {
    res.json({ categories: [], links: [], isAuth: isAuth(req), error: '请先初始化数据库' });
  }
});

// POST /api/login - 密码验证
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: '密码错误' });
});

// GET /api/export - 导出 JSON 备份
router.get('/export', async (req, res) => {
  if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });

  const [categories] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
  const [links] = await pool.query('SELECT * FROM links ORDER BY id DESC');

  const data = {
    version: '2.0-no-stats',
    date: new Date().toISOString(),
    categories,
    links: links.map(l => ({ ...l, is_private: l.is_private ? 1 : 0 }))
  };

  const filename = `nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(data);
});

// POST /api/import - 导入 JSON 恢复
router.post('/import', async (req, res) => {
  if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });

  const data = req.body;
  if (!data.categories || !data.links) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DELETE FROM links');
    await conn.query('DELETE FROM categories');
    await conn.query('ALTER TABLE categories AUTO_INCREMENT = 1');
    await conn.query('ALTER TABLE links AUTO_INCREMENT = 1');

    for (const c of data.categories) {
      await conn.query(
        'INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)',
        [c.id, c.name, c.sort_order]
      );
    }

    for (const l of data.links) {
      await conn.query(
        'INSERT INTO links (id, category_id, title, url, description, icon_url, is_private) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [l.id, l.category_id, l.title, l.url, l.description || null, l.icon_url || null, l.is_private || 0]
      );
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
    res.json({ success: true, msg: `成功恢复 ${data.links.length} 条链接` });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// /api/category - 分类 CRUD
router.route('/category')
  .post(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { name, sort_order } = req.body;
    await pool.query('INSERT INTO categories (name, sort_order) VALUES (?, ?)', [name, sort_order || 0]);
    res.json({ success: true });
  })
  .put(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id, name, sort_order } = req.body;
    await pool.query('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?', [name, sort_order, id]);
    res.json({ success: true });
  })
  .delete(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.query;
    // ON DELETE CASCADE 自动删除关联 links
    await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ success: true });
  });

// /api/link - 链接 CRUD
router.route('/link')
  .post(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });

    const { category_id, title, url, description, icon_url, is_private } = req.body;

    let icon = icon_url;
    if (!icon && url) {
      try {
        const domain = new URL(url).hostname;
        icon = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      } catch (e) { /* ignore */ }
    }

    const safeDesc = description || null;
    const safeIcon = icon || null;

    await pool.query(
      'INSERT INTO links (category_id, title, url, description, icon_url, is_private) VALUES (?, ?, ?, ?, ?, ?)',
      [category_id, title, url, safeDesc, safeIcon, is_private ? 1 : 0]
    );
    res.json({ success: true });
  })
  .put(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });

    const { id, category_id, title, url, description, icon_url, is_private } = req.body;

    let icon = icon_url;
    if (!icon && url) {
      try {
        const domain = new URL(url).hostname;
        icon = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      } catch (e) { /* ignore */ }
    }

    const safeDesc = description || null;
    const safeIcon = icon || null;

    await pool.query(
      'UPDATE links SET category_id = ?, title = ?, url = ?, description = ?, icon_url = ?, is_private = ? WHERE id = ?',
      [category_id, title, url, safeDesc, safeIcon, is_private ? 1 : 0, id]
    );
    res.json({ success: true });
  })
  .delete(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.query;
    await pool.query('DELETE FROM links WHERE id = ?', [id]);
    res.json({ success: true });
  });

module.exports = router;
