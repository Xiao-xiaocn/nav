export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return new Response(HTML, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
  }
};

async function handleApi(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname.replace('/api/', '');

  const authHeader = request.headers.get('Authorization');
  const isAuth = authHeader === env.ADMIN_PASSWORD;
  const headers = { 'Content-Type': 'application/json' };
  const db = env.DB;

  try {
    // GET /api/data
    if (path === 'data' && method === 'GET') {
      const cats = await db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all();
      const linkSql = isAuth
        ? "SELECT * FROM links ORDER BY sort_order ASC, id DESC"
        : "SELECT * FROM links WHERE is_private = 0 ORDER BY sort_order ASC, id DESC";
      const links = await db.prepare(linkSql).all();
      return new Response(JSON.stringify({
        categories: cats.results || [],
        links: links.results || [],
        isAuth
      }), { headers });
    }

    // POST /api/login
    if (path === 'login' && method === 'POST') {
      const body = await request.json();
      if (body.password === env.ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
    }

    if (!isAuth) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });

    // GET /api/export
    if (path === 'export' && method === 'GET') {
      const cats = await db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all();
      const links = await db.prepare("SELECT * FROM links ORDER BY id DESC").all();
      const data = { version: "2.0", date: new Date().toISOString(), categories: cats.results, links: links.results };
      const filename = `nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
      return new Response(JSON.stringify(data, null, 2), {
        headers: { ...headers, 'Content-Disposition': `attachment; filename="${filename}"` }
      });
    }

    // POST /api/import
    if (path === 'import' && method === 'POST') {
      const data = await request.json();
      if (!data.categories || !data.links) return new Response("Invalid JSON", { status: 400 });

      await db.prepare("DELETE FROM links").run();
      await db.prepare("DELETE FROM categories").run();
      await db.prepare("DELETE FROM sqlite_sequence WHERE name='links' OR name='categories'").run();

      const catStmt = db.prepare("INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)");
      const catBatch = data.categories.map(c => catStmt.bind(c.id, c.name, c.sort_order || 0));
      if (catBatch.length > 0) await db.batch(catBatch);

      const linkStmt = db.prepare("INSERT INTO links (id, category_id, title, url, description, icon_url, is_private, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const chunkSize = 10;
      for (let i = 0; i < data.links.length; i += chunkSize) {
        const chunk = data.links.slice(i, i + chunkSize);
        const linkBatch = chunk.map(l => linkStmt.bind(l.id, l.category_id, l.title, l.url, l.description || null, l.icon_url || null, l.is_private || 0, l.sort_order || 0));
        await db.batch(linkBatch);
      }
      return new Response(JSON.stringify({ success: true, msg: `成功恢复 ${data.links.length} 条链接` }), { headers });
    }

    // POST /api/sort
    if (path === 'sort' && method === 'POST') {
      const { type, ids } = await request.json();
      if (!type || !Array.isArray(ids)) return new Response(JSON.stringify({ error: '缺少 type 或 ids' }), { status: 400, headers });
      const table = type === 'category' ? 'categories' : 'links';
      const stmts = ids.map((id, i) => db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(i, id));
      await db.batch(stmts);
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // PUT /api/link/move
    if (path === 'link/move' && method === 'PUT') {
      const { id, category_id } = await request.json();
      const { results } = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS maxSort FROM links WHERE category_id = ?").bind(category_id).all();
      await db.prepare("UPDATE links SET category_id = ?, sort_order = ? WHERE id = ?").bind(category_id, results[0].maxSort, id).run();
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // /api/category
    if (path === 'category') {
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        await db.batch([
          db.prepare("DELETE FROM links WHERE category_id = ?").bind(id),
          db.prepare("DELETE FROM categories WHERE id = ?").bind(id)
        ]);
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'POST' || method === 'PUT') {
        const body = await request.json();
        if (method === 'POST') await db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)").bind(body.name, body.sort_order || 0).run();
        else await db.prepare("UPDATE categories SET name = ?, sort_order = ? WHERE id = ?").bind(body.name, body.sort_order, body.id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    // /api/link
    if (path === 'link') {
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      if (method === 'POST' || method === 'PUT') {
        const body = await request.json();
        let icon = body.icon_url;
        if (!icon && body.url) { try { icon = `https://icons.duckduckgo.com/ip3/${new URL(body.url).hostname}.ico`; } catch (e) {} }

        if (method === 'POST') {
          const { results } = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS maxSort FROM links").all();
          await db.prepare("INSERT INTO links (category_id, title, url, description, icon_url, is_private, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(body.category_id, body.title, body.url, body.description || null, icon || null, body.is_private ? 1 : 0, results[0].maxSort).run();
        } else {
          await db.prepare("UPDATE links SET category_id=?, title=?, url=?, description=?, icon_url=?, is_private=? WHERE id=?")
            .bind(body.category_id, body.title, body.url, body.description || null, icon || null, body.is_private ? 1 : 0, body.id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

  } catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers }); }
  return new Response("Not Found", { status: 404 });
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<link rel="icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAQAElEQVR4Aey9dXCcWZbm+V/e2N3ZndiJjr6dnumNjmhPT3VXd1V3dVV3dZWhS0pTMZOyQMnMzMzMzMzMYsuWzJIsZmZmZmZm5r3//bPj4lM5k4SmK7NOxMWL5/E997x7X4YCBYrD339/zNFjxzl16jQnT57i2LHjHDlylMOHj3Do0CEO/nSQ/fv3s2/fXnbv2sWuXbvYvXsXO7ZvZ/u2bWzbtpWtW7awdcsWtmzewqaNG9m4YQPrN6xn3Tp91q5Zw5o1q1m9ejUrV61k+YoVLFu2jKVLl7FkyRIWLVrEokWLPqZFixYyf8F85s2bx9y5c5kzZw6zZ81i9qxZzJw5k5kzZjBjxnSmT5/OtGnTmDp1CpMnT2LSpEnMmTOHs2fPTXoT8MrH//T3yWHPgwC7xfNvwF/+fH+Qn7/M9xdfwNfftZXN/U9Hx5e/99cfvv4G3Od5a7mHw79c/Pvzz6Pla41/DujHf3v0u0i2x49G4+7cX+G9/k4+1efzm9NXf4v1/VTy5/+nAf8B39/P/v7lzx0+3j3b7e3Hc8CgT5jVp2D93nr7yWdvu7d/fz+Nflb52fY++/zL77//hMx+67v9L2l2v7/8U8y/e49PH+L3+EP5//3v9OnH7/n1+31o1r/c/Qk//y+j/v+pfwdQf4b9vveAsQ4B/a5d+3ad9y9h/f+Ws/9fRj+BsH7+B/y3/xS//0v/EkZLSip3b96kueV3QP25Jf/XcOr3f/qvBL5+YmM/qP4N/E79flHXD2n8Cb4U6t+Q1R85H/6gfoMG9esAXz81/xf2t39c35/1+S9h+0n/l7D8Hn/Gfz8n6X/FH8z/j/f3b3v+S338vvf/+b3/+PW/7/nf8vw/X8ef5+uf8/WX+PkL+egf+4k/l9+ft/f7YOifu//3z/+nz//4+v37eP7836v92+/99x8e+1/h/j+8/3uh/p9o8kP65+//8f6/f/58X/9c/++fP7+vf67//v3z+/rH9X/3/u8fev97oX+9wD++/9H9P/v8H5Hz7w8v/98fXv+f4vm/Btd/jrz+FnF+2+b+HmF+Wc+/5f5vcf4tv39N3r9F3H8+Q/wH+vs/gH//nIf+8y/0b4GqL3n97a7ge9//5fMvoX7f/+XzL6F+/9/P+37x+X/w/h/z/+N9F37/v39pL/+d5+Pf+zL/4el/uO/6/X8P8U+Wn98Fkv/PJf4dfz6L/x+l37+j//fzL6F++/DP4/332fc/H/v0zz74++cf7u3/T83/9nE/V/Of6f9f3L8v0a/xfz/K/z/5/XMF94XnHxA/W9i/U/jfa8Tvu/9/6fdf+Tv/37t+H3j+pef/b4Pyj/bBf4H8/7/6/X8//d/7/X/u/z/cz/8PHZt/4v//n33/o/rfP/2DL//+8X9f/B+8/H/4+P+xb/7f7Pefk/nn///x+/+T5/f7/S85/3/v/v/n9/wp+P/fPf/7fv2n7v882v3t/v3/7/fyH6h/H/ef+/Xl6c/v/u94/0+//2ff/P8b+D/0Tf8rxd+//38x/F6reXD+Iv538L8L/5/1yf8D/P8/8IdhL8DDDwAAAABJRU5ErkJggg==">
<title>我的导航站</title>
<script>(function(){var w=console.warn;console.warn=function(){if(arguments[0]&&typeof arguments[0]==='string'&&arguments[0].includes('cdn.tailwindcss.com'))return;w.apply(console,arguments)}})();</script>
<script src="https://cdn.tailwindcss.com"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.13.5/cdn.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js"></script>
<style>
[x-cloak]{display:none!important}
html{-webkit-tap-highlight-color:transparent}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
.dark ::-webkit-scrollbar-thumb{background:#475569}
.nav-active{background-color:rgba(59,130,246,0.1);color:#2563eb;border-right:3px solid #2563eb}
.dark .nav-active{background-color:rgba(59,130,246,0.2);color:#60a5fa}
.safe-top-pt{padding-top:env(safe-area-inset-top)}
.sortable-ghost{opacity:0.3;transform:scale(0.95)}
.sortable-chosen{box-shadow:0 10px 25px rgba(0,0,0,0.15);z-index:50}
.sortable-drag{opacity:0}
</style>
<script>tailwind.config={darkMode:'class'}</script>
</head>
<body class="bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition-colors duration-300 h-screen flex overflow-hidden selection:bg-blue-500/30" x-data="app()" x-init="init()">

<aside class="hidden md:block h-full bg-white/80 dark:bg-gray-800/80 backdrop-blur border-r border-gray-200 dark:border-gray-700 transition-all duration-300 overflow-hidden shrink-0 z-20"
  :style="sidebarOpen ? 'width: 240px; opacity: 1;' : 'width: 0px; opacity: 0;'">
  <div class="w-[240px]">
    <div class="h-16 flex items-center justify-center border-b border-gray-100 dark:border-gray-700/50">
      <span class="text-2xl mr-2">🧭</span>
      <span class="font-bold text-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-transparent bg-clip-text">NanoNav</span>
    </div>
    <div class="overflow-y-auto h-[calc(100vh-64px)] py-4 px-2 space-y-1 cat-sort-list">
      <template x-for="cat in categories" :key="cat.id">
        <a :href="'#cat-' + cat.id" @click.prevent="scrollToCat(cat.id)" :data-cat-id="cat.id"
           :class="activeCat === cat.id ? 'nav-active' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-400'"
           class="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors cursor-pointer group whitespace-nowrap">
          <span x-show="isAdmin && editMode" class="drag-handle-cat text-gray-300 dark:text-gray-600 cursor-grab text-xs">⠿</span>
          <span class="text-lg opacity-70">📂</span>
          <span class="font-medium text-sm truncate" x-text="cat.name"></span>
          <span class="ml-auto text-xs opacity-40 group-hover:opacity-100 bg-gray-100 dark:bg-gray-700 px-1.5 rounded-full" x-text="getLinks(cat.id).length"></span>
        </a>
      </template>
    </div>
  </div>
</aside>

<div class="flex-1 flex flex-col h-full overflow-hidden relative w-full">
  <header class="md:hidden fixed top-0 left-0 right-0 z-40 transition-all duration-300 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50 shadow-sm">
    <div class="w-full h-[env(safe-area-inset-top)]"></div>
    <div class="px-4 h-12 flex items-center justify-between">
      <button @click="mobileMenuOpen = !mobileMenuOpen" class="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
      </button>
      <div class="font-bold text-lg tracking-tight bg-gradient-to-r from-blue-600 to-indigo-500 text-transparent bg-clip-text flex items-center gap-1.5">
        <span>🧭</span><span>NanoNav</span>
      </div>
      <button @click="toggleTheme()" class="p-2 -mr-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
        <span x-show="theme === 'light'" class="text-amber-500">🌞</span>
        <span x-show="theme === 'dark'" x-cloak class="text-blue-300">🌙</span>
        <span x-show="theme === 'auto'" x-cloak>💻</span>
      </button>
    </div>
    <div class="px-4 pb-3">
      <div class="relative group">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg class="w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        </div>
        <input type="text" x-model="search" placeholder="搜索..." class="w-full bg-gray-100 dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 text-sm rounded-xl py-2 pl-9 pr-4 border-none ring-0 focus:ring-2 focus:ring-blue-500/50 placeholder-gray-400 transition-all duration-300 shadow-inner">
      </div>
    </div>
  </header>

  <nav class="hidden md:flex safe-top-pt bg-white/80 dark:bg-gray-800/80 backdrop-blur border-b border-gray-200 dark:border-gray-700 shrink-0 z-20 relative transition-all">
    <div class="h-16 px-4 flex w-full items-center justify-between gap-4">
      <div class="flex items-center gap-3 shrink-0">
        <button @click="sidebarOpen = !sidebarOpen" class="hidden md:flex p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
          <svg x-show="sidebarOpen" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>
          <svg x-show="!sidebarOpen" x-cloak class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
        </button>
      </div>
      <div class="flex flex-1 justify-center px-4 lg:px-8">
        <div class="max-w-2xl w-full relative">
          <input type="text" x-model="search" placeholder="搜索链接..." class="w-full bg-gray-100 dark:bg-gray-700/50 border-0 rounded-full py-2 pl-10 pr-4 focus:ring-2 focus:ring-blue-500/50 text-sm transition-all shadow-inner">
          <span class="absolute left-3.5 top-2 text-gray-400">🔍</span>
        </div>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <div x-show="isAdmin" x-cloak class="flex items-center gap-2 mr-2 bg-gray-100 dark:bg-gray-700/50 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600">
          <span class="text-xs font-medium text-gray-500 select-none">编辑模式</span>
          <button @click="editMode = !editMode" :class="editMode ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'" class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none">
            <span :class="editMode ? 'translate-x-4' : 'translate-x-1'" class="absolute top-1 left-0.5 h-3 w-3 rounded-full bg-white transition-transform"></span>
          </button>
        </div>
        <button @click="toggleTheme()" class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition">
          <span x-show="theme === 'light'">🌞</span><span x-show="theme === 'dark'" x-cloak>🌙</span><span x-show="theme === 'auto'" x-cloak>💻</span>
        </button>
        <button x-show="!isAdmin" @click="showLogin=true" class="text-sm font-medium hover:text-blue-600 px-3 py-1.5 transition">登录</button>
        <div x-show="isAdmin" class="relative" x-data="{open:false}">
          <img src="https://ui-avatars.com/api/?name=Admin&background=0D8ABC&color=fff" @click="open=!open" class="w-8 h-8 rounded-full cursor-pointer hover:ring-2 ring-blue-500 transition">
          <div x-show="open" @click.away="open=false" x-cloak class="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 py-1 text-sm z-50">
            <button @click="exportData()" class="block w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700">📤 导出备份</button>
            <button @click="$refs.fileInputPC.click()" class="block w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700">📥 导入恢复</button>
            <div class="h-px bg-gray-100 dark:bg-gray-700 my-1"></div>
            <button @click="logout()" class="block w-full text-left px-4 py-2 text-red-500 hover:bg-gray-50 dark:hover:bg-gray-700">退出登录</button>
          </div>
          <input type="file" x-ref="fileInputPC" class="hidden" accept=".json" @change="importData($event)">
        </div>
      </div>
    </div>
  </nav>

  <main class="flex-1 overflow-y-auto scroll-smooth" id="main-scroll" @scroll="onScroll">
    <div class="md:hidden w-full h-[calc(env(safe-area-inset-top)+6rem)]"></div>
    <div class="p-4 md:p-8 max-w-7xl mx-auto pb-24 md:pb-20">
      <div x-show="isAdmin && editMode" x-cloak class="mb-6 flex gap-3 animate-fade-in p-4 bg-white dark:bg-gray-800 rounded-xl border border-blue-100 dark:border-blue-800/30 shadow-sm">
        <button @click="editCat({})" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-blue-700 transition">+ 新增分类</button>
        <button @click="editLink({})" class="flex-1 px-4 py-2 bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-300 rounded-lg text-sm font-bold border border-blue-200 dark:border-gray-600 hover:bg-blue-100 transition">+ 新增链接</button>
      </div>

      <div class="space-y-8">
        <div x-show="!loading && categories.length === 0" class="text-center py-20">
          <div class="text-6xl mb-4 grayscale opacity-50">🏝️</div>
          <p class="text-gray-500">暂无数据</p>
        </div>

        <template x-for="cat in filteredCats" :key="cat.id">
          <div :id="'cat-'+cat.id" class="transition-all duration-500 scroll-mt-32 md:scroll-mt-20">
            <div class="flex items-center justify-between mb-3 pb-2 border-b border-dashed border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                <span class="text-blue-500">#</span><span x-text="cat.name"></span>
              </h2>
              <div x-show="isAdmin && editMode" class="flex gap-2 text-xs">
                <button @click="editCat(cat)" class="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-blue-600 rounded hover:bg-blue-50">修改</button>
                <button @click="delCat(cat.id)" class="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-red-500 rounded hover:bg-red-50">删除</button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4 link-grid" :data-cat-id="cat.id">
              <template x-for="link in getLinks(cat.id)" :key="link.id">
                <div :data-link-id="link.id" class="group relative bg-white dark:bg-gray-800 rounded-xl p-3 border transition-all duration-200 shadow-sm flex gap-3 overflow-hidden"
                     :class="isAdmin && editMode ? 'border-blue-300 dark:border-blue-700 border-dashed bg-blue-50/10' : 'border-gray-100 dark:border-gray-700/50 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-lg hover:-translate-y-1'">

                  <div x-show="isAdmin && editMode" class="drag-handle-link flex-shrink-0 flex items-center text-gray-300 dark:text-gray-600 cursor-grab text-sm">⠿</div>
                  <div class="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center overflow-hidden border border-gray-100 dark:border-gray-600">
                    <img :src="getIconUrl(link)" class="w-full h-full object-contain" loading="lazy" @error="$el.style.display='none'; $el.nextElementSibling.style.display='flex'">
                    <div class="hidden w-full h-full items-center justify-center bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-bold text-lg" x-text="link.title.substring(0,1).toUpperCase()"></div>
                  </div>

                  <div class="flex-1 min-w-0 flex flex-col justify-center">
                    <a :href="isAdmin && editMode ? 'javascript:void(0)' : link.url" :target="isAdmin && editMode ? '' : '_blank'" rel="noopener noreferrer" @click="isAdmin && editMode ? editLink(link) : null" class="block outline-none cursor-pointer">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-gray-800 dark:text-gray-100 truncate text-sm" x-text="link.title"></span>
                        <span x-show="link.is_private" class="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 px-1 rounded border border-red-100 dark:border-red-800 shrink-0">私有</span>
                      </div>
                      <div class="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5" x-text="link.description || link.url"></div>
                    </a>
                  </div>

                  <div x-show="isAdmin && editMode" class="absolute top-2 right-2 flex gap-1.5 z-10">
                    <button @click.stop="editLink(link)" class="p-1.5 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded shadow-sm hover:bg-blue-200 transition" title="编辑">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button @click.stop="delLink(link.id)" class="p-1.5 bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 rounded shadow-sm hover:bg-red-200 transition" title="删除">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  </div>
                </div>
              </template>

              <div x-show="isAdmin && editMode" class="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col items-center justify-center text-sm text-gray-400 cursor-pointer hover:border-blue-400 hover:text-blue-500 transition h-[72px]" @click="editLink({category_id: cat.id})">
                <span class="text-2xl mb-1">+</span><span class="text-xs">添加链接</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </main>
</div>

<div x-show="mobileMenuOpen" class="fixed inset-0 z-50 bg-black/60 md:hidden backdrop-blur-sm" @click="mobileMenuOpen = false" x-transition.opacity></div>
<div x-show="mobileMenuOpen" class="fixed inset-y-0 left-0 z-[60] w-72 bg-white dark:bg-gray-800 shadow-2xl md:hidden transform transition-transform flex flex-col"
  x-transition:enter="transition ease-out duration-300" x-transition:enter-start="-translate-x-full" x-transition:enter-end="translate-x-0"
  x-transition:leave="transition ease-in duration-300" x-transition:leave-start="translate-x-0" x-transition:leave-end="-translate-x-full">
  <div class="h-auto min-h-[10rem] bg-gradient-to-br from-blue-600 to-indigo-700 flex flex-col justify-end p-6 shrink-0 text-white relative overflow-hidden safe-top-pt">
    <div class="absolute top-0 right-0 p-4 opacity-20 text-6xl">🧭</div>
    <div class="flex items-center gap-3 z-10">
      <img :src="isAdmin ? 'https://ui-avatars.com/api/?name=Admin&background=fff&color=2563eb' : 'https://ui-avatars.com/api/?name=Guest&background=ffffff&color=999'" class="w-12 h-12 rounded-full border-2 border-white/30 shadow-md">
      <div><div class="font-bold text-lg" x-text="isAdmin ? '管理员' : '访客'"></div><div class="text-xs text-blue-100 opacity-80" x-text="isAdmin ? '已登录' : '未登录'"></div></div>
    </div>
    <button x-show="!isAdmin" @click="mobileMenuOpen=false; setTimeout(()=>showLogin=true, 50)" class="absolute right-4 bottom-6 bg-white/20 hover:bg-white/30 text-xs px-3 py-1.5 rounded-full backdrop-blur border border-white/20 transition z-20">点击登录</button>
  </div>
  <div class="flex-1 overflow-y-auto py-2">
    <div class="px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">分类导航</div>
    <div class="cat-sort-list">
      <template x-for="cat in categories" :key="cat.id">
        <a :href="'#cat-' + cat.id" @click="mobileMenuOpen = false; scrollToCat(cat.id)" :data-cat-id="cat.id" class="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 border-l-4 border-transparent hover:border-blue-500 transition-all">
          <span x-show="isAdmin && editMode" class="drag-handle-cat text-gray-300 dark:text-gray-600 cursor-grab text-xs mr-2">⠿</span>
          <span class="font-medium truncate flex-1" x-text="cat.name"></span>
          <span class="text-xs bg-gray-100 dark:bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full ml-2 shrink-0" x-text="getLinks(cat.id).length"></span>
        </a>
      </template>
    </div>
  </div>
  <div class="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 space-y-4 safe-bottom-pb">
    <div x-show="isAdmin" class="grid grid-cols-2 gap-2 mb-2">
      <button @click="exportData()" class="flex items-center justify-center gap-1 py-2 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-200 rounded border border-gray-200 dark:border-gray-600 text-xs">📤 备份</button>
      <button @click="$refs.fileInputMobile.click()" class="flex items-center justify-center gap-1 py-2 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-200 rounded border border-gray-200 dark:border-gray-600 text-xs">📥 恢复</button>
      <input type="file" x-ref="fileInputMobile" class="hidden" accept=".json" @change="importData($event)">
    </div>
    <div x-show="isAdmin" class="flex items-center justify-between px-2">
      <span class="text-sm font-medium text-gray-600 dark:text-gray-300">编辑模式</span>
      <button @click="editMode = !editMode" :class="editMode ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"><span :class="editMode ? 'translate-x-6' : 'translate-x-1'" class="absolute top-1 left-0.5 h-4 w-4 rounded-full bg-white transition-transform"></span></button>
    </div>
    <div class="flex bg-gray-200 dark:bg-gray-700 p-1 rounded-lg">
      <button @click="setTheme('light')" :class="theme==='light' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'" class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all">浅色</button>
      <button @click="setTheme('auto')" :class="theme==='auto' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'" class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all">自动</button>
      <button @click="setTheme('dark')" :class="theme==='dark' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'" class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all">深色</button>
    </div>
    <button x-show="!isAdmin" @click="mobileMenuOpen=false; setTimeout(()=>showLogin=true, 50)" class="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition shadow-md">管理员登录</button>
    <button x-show="isAdmin" @click="logout()" class="w-full py-2.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition border border-red-100">退出登录</button>
  </div>
</div>

<div x-show="showLogin" class="fixed inset-0 z-[70] flex items-center justify-center p-4" x-cloak><div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="showLogin=false"></div><div class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl w-full max-w-sm relative z-10 animate-scale-in"><h3 class="font-bold text-lg mb-4 text-center">管理员登录</h3><input type="password" x-model="pwd" @keyup.enter="login()" class="w-full border dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg mb-4 focus:ring-2 ring-blue-500 outline-none" placeholder="输入密码"><button @click="login()" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">登录</button></div></div>
<div x-show="linkModal || catModal" class="fixed inset-0 z-[70] flex items-center justify-center p-4" x-cloak>
  <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="linkModal=false;catModal=false"></div>
  <div x-show="linkModal" class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl w-full max-w-md relative z-10 animate-scale-in max-h-[90vh] overflow-y-auto"><h3 class="font-bold text-lg mb-4" x-text="formLink.id ? '编辑链接' : '添加链接'"></h3><div class="space-y-4"><div><label class="block text-xs text-gray-500 mb-1">分类</label><select x-model="formLink.category_id" class="w-full border dark:border-gray-600 bg-transparent p-2.5 rounded-lg text-sm"><template x-for="c in categories" :key="c.id"><option :value="c.id" x-text="c.name"></option></template></select></div><div class="grid grid-cols-2 gap-4"><div><label class="block text-xs text-gray-500 mb-1">标题</label><input x-model="formLink.title" class="w-full border dark:border-gray-600 bg-transparent p-2.5 rounded-lg text-sm"></div><div><label class="block text-xs text-gray-500 mb-1">图标URL</label><input x-model="formLink.icon_url" class="w-full border dark:border-gray-600 bg-transparent p-2.5 rounded-lg text-sm"></div></div><div><label class="block text-xs text-gray-500 mb-1">网址</label><input x-model="formLink.url" class="w-full border dark:border-gray-600 bg-transparent p-2.5 rounded-lg text-sm"></div><div><label class="block text-xs text-gray-500 mb-1">描述</label><textarea x-model="formLink.description" class="w-full border dark:border-gray-600 bg-transparent p-2.5 rounded-lg text-sm" rows="2"></textarea></div><div class="flex items-center gap-2"><input type="checkbox" x-model="formLink.is_private" class="rounded text-blue-600"><span class="text-sm">设为私有</span></div></div><div class="flex justify-end gap-3 mt-6"><button @click="linkModal=false" class="px-4 py-2 text-sm text-gray-500">取消</button><button @click="saveLink()" class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm shadow-md">保存</button></div></div>
  <div x-show="catModal" class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl w-full max-w-sm relative z-10 animate-scale-in"><h3 class="font-bold text-lg mb-4">分类管理</h3><div class="space-y-4"><input x-model="formCat.name" class="w-full border dark:border-gray-600 bg-transparent p-3 rounded-lg text-sm" placeholder="名称"><input x-model="formCat.sort_order" type="number" class="w-full border dark:border-gray-600 bg-transparent p-3 rounded-lg text-sm" placeholder="排序"></div><div class="flex justify-end gap-3 mt-6"><button @click="catModal=false" class="px-4 py-2 text-sm text-gray-500">取消</button><button @click="saveCat()" class="px-6 py-2 bg-green-600 text-white rounded-lg text-sm shadow-md">保存</button></div></div>
</div>

<script>
  function app() {
    return {
      loading: true, search: '', categories: [], links: [], isAdmin: false, theme: localStorage.theme || 'auto', sidebarOpen: true, mobileMenuOpen: false, activeCat: null, editMode: false, showLogin: false, pwd: '', linkModal: false, formLink: {}, catModal: false, formCat: {},
      async init() { this.applyTheme(); window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if(this.theme==='auto') this.applyTheme(); }); this.$watch('editMode', val => { if (val && this.isAdmin) setTimeout(() => this.initSortable(), 100); }); await this.load(); },
      async load() { this.loading = true; const token = localStorage.getItem('nav_token'); const headers = token ? { 'Authorization': token } : {}; try { const res = await fetch('/api/data', { headers }); const data = await res.json(); this.categories = data.categories || []; this.links = data.links || []; this.isAdmin = data.isAuth; if (!data.isAuth && token) localStorage.removeItem('nav_token'); } catch (e) { console.error(e); } finally { this.loading = false; } },
      initSortable() {
        if (!this.isAdmin || !this.editMode || typeof Sortable === 'undefined') return;
        document.querySelectorAll('.cat-sort-list').forEach(list => {
          if (list._sortable) list._sortable.destroy();
          list._sortable = Sortable.create(list, { animation: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', dragClass: 'sortable-drag', handle: '.drag-handle-cat', onEnd: (evt) => { const ids = [...evt.target.querySelectorAll('[data-cat-id]')].map(el => parseInt(el.dataset.catId)); this.sortSave('category', ids); } });
        });
        document.querySelectorAll('.link-grid').forEach(grid => {
          if (grid._sortable) grid._sortable.destroy();
          grid._sortable = Sortable.create(grid, { animation: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', dragClass: 'sortable-drag', handle: '.drag-handle-link', group: 'links', onEnd: (evt) => { const fromCatId = parseInt(evt.from.dataset.catId); const toCatId = parseInt(evt.to.dataset.catId); const linkId = parseInt(evt.item.dataset.linkId); const targetIds = [...evt.to.querySelectorAll('[data-link-id]')].map(el => parseInt(el.dataset.linkId)); this.sortSave('link', targetIds); if (fromCatId !== toCatId) { this.linkMove(linkId, toCatId); setTimeout(() => this.load(), 400); } } });
        });
      },
      async sortSave(type, ids) { await this.req('/api/sort', 'POST', { type, ids }); },
      async linkMove(id, category_id) { await this.req('/api/link/move', 'PUT', { id, category_id }); },
      getIconUrl(link) { if (link.icon_url) return link.icon_url; try { return 'https://api.iowen.cn/favicon/' + new URL(link.url).hostname + '.png'; } catch(e) { return ''; } },
      scrollToCat(id) { this.activeCat = id; const el = document.getElementById('cat-' + id); const main = document.getElementById('main-scroll'); if(el && main) { const offset = window.innerWidth < 768 ? 160 : 80; main.scrollTo({ top: el.offsetTop - offset, behavior: 'smooth' }); } },
      onScroll(e) { const main = e.target; for (let cat of this.categories) { const el = document.getElementById('cat-' + cat.id); if (el && el.offsetTop <= main.scrollTop + 180) this.activeCat = cat.id; } },
      toggleTheme() { const modes = ['auto', 'light', 'dark']; this.setTheme(modes[(modes.indexOf(this.theme) + 1) % modes.length]); },
      setTheme(mode) { this.theme = mode; localStorage.theme = mode; this.applyTheme(); },
      applyTheme() { let isDark = this.theme === 'dark'; if (this.theme === 'auto') isDark = window.matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.classList.toggle('dark', isDark); },
      getLinks(catId) { return this.links.filter(l => { const matchCat = l.category_id === catId; const s = this.search.toLowerCase().trim(); if (!s) return matchCat; return matchCat && (l.title.toLowerCase().includes(s) || l.url.toLowerCase().includes(s)); }); },
      get filteredCats() { if (!this.search) return this.categories; return this.categories.filter(cat => this.getLinks(cat.id).length > 0); },
      async login() { const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: this.pwd})}); if (res.ok) { localStorage.setItem('nav_token', this.pwd); this.showLogin = false; this.pwd = ''; await this.load(); } else alert('密码错误'); },
      logout() { localStorage.removeItem('nav_token'); location.reload(); },
      editLink(l) { this.formLink = JSON.parse(JSON.stringify(l)); if (!this.formLink.id && !this.formLink.category_id && this.categories.length) this.formLink.category_id = this.categories[0].id; this.linkModal = true; },
      async saveLink() { if(!this.formLink.title || !this.formLink.url) return alert('标题网址必填'); await this.req('/api/link', this.formLink.id ? 'PUT' : 'POST', this.formLink); this.linkModal = false; this.load(); },
      async delLink(id) { if(confirm('删除?')) { await this.req('/api/link?id='+id, 'DELETE'); this.load(); } },
      editCat(c) { this.formCat = {...c}; this.catModal = true; },
      async saveCat() { if(!this.formCat.name) return alert('名称必填'); await this.req('/api/category', this.formCat.id ? 'PUT' : 'POST', this.formCat); this.catModal = false; this.load(); },
      async delCat(id) { if(confirm('删除分类会清空链接，确定?')) { await this.req('/api/category?id='+id, 'DELETE'); this.load(); } },
      async req(url, method, body) { const res = await fetch(url, { method, headers: {'Authorization': localStorage.getItem('nav_token'), 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : null }); if(!res.ok) alert('操作失败'); },
      async exportData() { const token = localStorage.getItem('nav_token'); if(!token) return alert('请先登录'); const res = await fetch('/api/export', { headers: {'Authorization': token} }); if (!res.ok) { alert('导出失败'); return; } const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'nav-backup-' + new Date().toISOString().slice(0,10) + '.json'; a.click(); window.URL.revokeObjectURL(url); },
      async importData(e) { const file = e.target.files[0]; if (!file) return; if(!confirm('⚠️ 警告：导入将覆盖当前所有数据！确定继续？')) return; const reader = new FileReader(); reader.onload = async (event) => { try { const json = JSON.parse(event.target.result); const res = await fetch('/api/import', { method: 'POST', headers: {'Authorization': localStorage.getItem('nav_token'), 'Content-Type': 'application/json'}, body: JSON.stringify(json) }); const result = await res.json(); if(result.success) { alert(result.msg); location.reload(); } else alert('导入失败: ' + (result.error || '未知错误')); } catch(err) { alert('文件解析失败'); } }; reader.readAsText(file); }
    }
  }
</script>
</body>
</html>`;