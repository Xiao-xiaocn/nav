const express = require('express');
const router = express.Router();
const pool = require('../db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('错误: 请在 .env 中设置 ADMIN_PASSWORD');
  process.exit(1);
}

function isAuth(req) {
  return req.headers.authorization === ADMIN_PASSWORD;
}

function fixUrl(u) {
  if (!u || typeof u !== 'string') return null;
  let fixed = u.trim();
  if (!/^https?:\/\//i.test(fixed)) {
    fixed = 'https://' + fixed;
  }
  try { new URL(fixed); return fixed; } catch { return null; }
}

// 简易登录限流: IP -> { count, resetAt }
const loginAttempts = new Map();
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW = 60_000;

function checkLoginRate(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW });
    return true;
  }
  if (entry.count >= LOGIN_LIMIT) return false;
  entry.count++;
  return true;
}

// GET /api/data
router.get('/data', async (req, res) => {
  try {
    const [categories] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
    const auth = isAuth(req);
    const linkSql = auth
      ? 'SELECT * FROM links ORDER BY sort_order ASC, id DESC'
      : 'SELECT * FROM links WHERE is_private = 0 ORDER BY sort_order ASC, id DESC';
    const [links] = await pool.query(linkSql);
    res.json({ categories, links, isAuth: auth });
  } catch (err) {
    console.error(err);
    res.json({ categories: [], links: [], isAuth: false, error: '请先初始化数据库' });
  }
});

// POST /api/login
router.post('/login', async (req, res) => {
  const ip = req.ip;
  if (!checkLoginRate(ip)) {
    return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
  }
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    loginAttempts.delete(ip);
    return res.json({ success: true });
  }
  // 失败延迟防止时序攻击
  await new Promise(r => setTimeout(r, 500));
  res.status(401).json({ error: '密码错误' });
});

// GET /api/export
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

// POST /api/import
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
        [c.id, String(c.name || ''), parseInt(c.sort_order) || 0]
      );
    }

    for (const l of data.links) {
      await conn.query(
        'INSERT INTO links (id, category_id, title, url, description, icon_url, is_private, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [l.id, l.category_id, String(l.title || ''), String(l.url || ''), l.description || null, l.icon_url || null, l.is_private ? 1 : 0, l.sort_order || 0]
      );
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
    res.json({ success: true, msg: `成功恢复 ${data.links.length} 条链接` });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: '导入失败' });
  } finally {
    conn.release();
  }
});

// POST /api/sort
router.post('/sort', async (req, res) => {
  if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
  const { type, ids } = req.body;
  if (!type || !Array.isArray(ids)) {
    return res.status(400).json({ error: '缺少 type 或 ids' });
  }
  const table = type === 'category' ? 'categories' : 'links';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < ids.length; i++) {
      await conn.query(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [i, parseInt(ids[i])]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: '排序失败' });
  } finally {
    conn.release();
  }
});

// /api/category
router.route('/category')
  .post(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { name, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    await pool.query('INSERT INTO categories (name, sort_order) VALUES (?, ?)', [String(name), parseInt(sort_order) || 0]);
    res.json({ success: true });
  })
  .put(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id, name, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    await pool.query('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?', [String(name), parseInt(sort_order) || 0, id]);
    res.json({ success: true });
  })
  .delete(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.query;
    await pool.query('DELETE FROM categories WHERE id = ?', [parseInt(id)]);
    res.json({ success: true });
  });

// /api/link
router.route('/link')
  .post(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { category_id, title, url, description, icon_url, is_private } = req.body;
    if (!title || !url) return res.status(400).json({ error: '标题和网址不能为空' });
    const safeUrl = fixUrl(url);
    if (!safeUrl) return res.status(400).json({ error: '网址格式不正确' });

    let icon = icon_url;
    if (!icon && safeUrl) {
      try {
        const domain = new URL(safeUrl).hostname;
        icon = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      } catch (e) { /* ignore */ }
    }

    const [[{ maxSort }]] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS maxSort FROM links');
    await pool.query(
      'INSERT INTO links (category_id, title, url, description, icon_url, is_private, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [category_id, String(title), String(safeUrl), description || null, icon || null, is_private ? 1 : 0, maxSort]
    );
    res.json({ success: true });
  })
  .put(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id, category_id, title, url, description, icon_url, is_private } = req.body;
    if (!title || !url) return res.status(400).json({ error: '标题和网址不能为空' });
    const safeUrl = fixUrl(url);
    if (!safeUrl) return res.status(400).json({ error: '网址格式不正确' });

    let icon = icon_url;
    if (!icon && safeUrl) {
      try {
        const domain = new URL(safeUrl).hostname;
        icon = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      } catch (e) { /* ignore */ }
    }

    await pool.query(
      'UPDATE links SET category_id = ?, title = ?, url = ?, description = ?, icon_url = ?, is_private = ? WHERE id = ?',
      [category_id, String(title), String(safeUrl), description || null, icon || null, is_private ? 1 : 0, id]
    );
    res.json({ success: true });
  })
  .delete(async (req, res) => {
    if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.query;
    await pool.query('DELETE FROM links WHERE id = ?', [parseInt(id)]);
    res.json({ success: true });
  });

// PUT /api/link/move
router.put('/link/move', async (req, res) => {
  if (!isAuth(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id, category_id } = req.body;
  const [[{ maxSort }]] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS maxSort FROM links WHERE category_id = ?', [category_id]);
  await pool.query('UPDATE links SET category_id = ?, sort_order = ? WHERE id = ?', [category_id, maxSort, id]);
  res.json({ success: true });
});

module.exports = router;
