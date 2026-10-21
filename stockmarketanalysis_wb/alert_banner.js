/* WB 选股模型 · 告警通知栏
   ------------------------------------------------------------------
   独立模块，由 html_generator_v5.py 注入。
   数据源: alerts.json (与 index.html 同目录，由巡检脚本生成)

   行为:
   - 顶部铃铛 + 未读角标
   - 点击展开下拉面板，列出告警事项
   - 点击「全部已读」清除未读角标
   - 已读状态存 localStorage (按告警 id 记录)，跨会话保留
   - 样式跟随站点紫色主题，用 CSS 变量，无硬编码深色
*/
(function () {
  'use strict';

  var DATA_URL = 'alerts.json';
  var LS_KEY = 'wb_alerts_read_ids';
  var POLL_MS = 5 * 60 * 1000;   // 5 分钟轮询一次

  var state = {
    alerts: [],
    readIds: {},
    open: false,
    loaded: false,
  };

  /* ---------- 工具 ---------- */
  function readIds() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function saveIds() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.readIds)); } catch (e) {}
  }
  function unreadCount() {
    var n = 0;
    for (var i = 0; i < state.alerts.length; i++) {
      if (!state.readIds[state.alerts[i].id]) n++;
    }
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      var p = function (x) { return x < 10 ? '0' + x : '' + x; };
      return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ts; }
  }
  function levelMeta(lv) {
    if (lv === 'error') return { label: '严重', color: 'var(--danger)', icon: '●' };
    if (lv === 'warn')  return { label: '警告', color: 'var(--warning)', icon: '▲' };
    return { label: '提示', color: 'var(--primary)', icon: '·' };
  }

  /* ---------- 样式 ---------- */
  var CSS = [
    '.wb-alert-root{position:relative;display:inline-block;}',
    '.wb-alert-btn{position:relative;background:transparent;border:1px solid var(--border);border-radius:6px;',
    '  width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);',
    '  font-size:15px;line-height:1;transition:all .15s;}',
    '.wb-alert-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-light);}',
    '.wb-alert-btn.has-unread{border-color:var(--accent);color:var(--accent);}',
    '.wb-alert-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;',
    '  background:var(--danger);color:#fff;font-size:10px;font-weight:600;line-height:16px;text-align:center;',
    '  box-shadow:0 0 0 2px var(--bg-surface);}',
    '.wb-alert-panel{position:absolute;top:38px;right:0;width:400px;max-width:88vw;max-height:70vh;overflow-y:auto;',
    '  background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-hover);',
    '  z-index:900;display:none;}',
    '.wb-alert-panel.open{display:block;}',
    '.wb-alert-head{display:flex;align-items:center;justify-content:space-between;gap:10px;',
    '  padding:12px 14px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-surface);',
    '  border-radius:10px 10px 0 0;}',
    '.wb-alert-head h4{margin:0;font-size:14px;font-weight:600;color:var(--text);}',
    '.wb-alert-clear{background:transparent;border:1px solid var(--border);border-radius:5px;padding:3px 9px;',
    '  font-size:12px;color:var(--text-secondary);cursor:pointer;}',
    '.wb-alert-clear:hover{border-color:var(--accent);color:var(--accent);}',
    '.wb-alert-clear[disabled]{opacity:.45;cursor:default;}',
    '.wb-alert-list{list-style:none;margin:0;padding:0;}',
    '.wb-alert-item{padding:11px 14px;border-bottom:1px solid var(--border);display:flex;gap:9px;align-items:flex-start;}',
    '.wb-alert-item:last-child{border-bottom:none;}',
    '.wb-alert-item.unread{background:var(--accent-light);}',
    '.wb-alert-dot{flex-shrink:0;width:7px;height:7px;border-radius:50%;margin-top:6px;}',
    '.wb-alert-body{flex:1;min-width:0;}',
    '.wb-alert-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px;display:flex;',
    '  align-items:center;gap:6px;flex-wrap:wrap;}',
    '.wb-alert-lv{font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;background:var(--accent-light);color:var(--primary);}',
    '.wb-alert-detail{font-size:12px;color:var(--text-secondary);line-height:1.55;word-break:break-word;}',
    '.wb-alert-action{font-size:12px;color:var(--accent);margin-top:4px;display:block;}',
    '.wb-alert-time{font-size:11px;color:var(--text-muted);margin-top:4px;}',
    '.wb-alert-empty{padding:30px 16px;text-align:center;color:var(--text-muted);font-size:13px;}',
    '.wb-alert-empty .ok{font-size:26px;color:var(--success);display:block;margin-bottom:6px;}',
    '.wb-alert-meta{padding:8px 14px;font-size:11px;color:var(--text-muted);background:var(--bg);',
    '  border-top:1px solid var(--border);border-radius:0 0 10px 10px;}',
    '@media(max-width:640px){.wb-alert-panel{width:calc(100vw - 32px);right:-8px;}}',
  ].join('');

  /* ---------- 渲染 ---------- */
  function buildUI() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.className = 'wb-alert-root';
    root.innerHTML =
      '<button class="wb-alert-btn" id="wbAlertBtn" title="告警通知" aria-label="告警通知">🔔</button>' +
      '<div class="wb-alert-panel" id="wbAlertPanel">' +
        '<div class="wb-alert-head">' +
          '<h4>告警通知 <span id="wbAlertCount" style="color:var(--text-muted);font-weight:400;font-size:12px;"></span></h4>' +
          '<button class="wb-alert-clear" id="wbAlertClear">全部已读</button>' +
        '</div>' +
        '<ul class="wb-alert-list" id="wbAlertList"></ul>' +
        '<div class="wb-alert-meta" id="wbAlertMeta"></div>' +
      '</div>';

    // 挂载点：优先放进 header 的 #wbAlertSlot（与导航同排），
    // 没有则退回 body 末尾（独立浮层，不影响布局）
    var slot = document.getElementById('wbAlertSlot');
    if (slot) {
      slot.appendChild(root);
    } else {
      document.body.appendChild(root);
    }

    document.getElementById('wbAlertBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    document.getElementById('wbAlertClear').addEventListener('click', function (e) {
      e.stopPropagation();
      markAllRead();
    });
    document.addEventListener('click', function (e) {
      if (state.open && !root.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  function toggle() {
    state.open ? close() : open();
  }
  function open() {
    state.open = true;
    document.getElementById('wbAlertPanel').classList.add('open');
    // 打开面板时把当前可见的告警标为已读（符合"阅读后清除未读"）
    markAllRead(true);
    render();
  }
  function close() {
    state.open = false;
    document.getElementById('wbAlertPanel').classList.remove('open');
    render();
  }

  function markAllRead(silent) {
    var changed = false;
    for (var i = 0; i < state.alerts.length; i++) {
      var id = state.alerts[i].id;
      if (!state.readIds[id]) { state.readIds[id] = Date.now(); changed = true; }
    }
    if (changed) saveIds();
    if (!silent) render();
  }

  function render() {
    var btn = document.getElementById('wbAlertBtn');
    var badge = btn.querySelector('.wb-alert-badge');
    var n = unreadCount();
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wb-alert-badge';
        btn.appendChild(badge);
      }
      badge.textContent = n > 99 ? '99+' : String(n);
      btn.classList.add('has-unread');
    } else {
      if (badge) badge.remove();
      btn.classList.remove('has-unread');
    }

    var list = document.getElementById('wbAlertList');
    if (!state.alerts.length) {
      list.innerHTML = '<li class="wb-alert-empty"><span class="ok">✓</span>当前没有告警<br>' +
        '<span style="font-size:12px;">每日 18:30 自动巡检选股模型运行状态</span></li>';
    } else {
      var html = '';
      for (var i = 0; i < state.alerts.length; i++) {
        var a = state.alerts[i];
        var m = levelMeta(a.level);
        var isUnread = !state.readIds[a.id];
        html += '<li class="wb-alert-item' + (isUnread ? ' unread' : '') + '">' +
          '<span class="wb-alert-dot" style="background:' + m.color + ';"></span>' +
          '<div class="wb-alert-body">' +
            '<div class="wb-alert-title">' + esc(a.title) +
              '<span class="wb-alert-lv" style="color:' + m.color + ';">' + m.label + '</span></div>' +
            '<div class="wb-alert-detail">' + esc(a.detail) + '</div>' +
            (a.action ? '<span class="wb-alert-action">→ ' + esc(a.action) + '</span>' : '') +
            '<div class="wb-alert-time">' + esc(fmtTime(a.ts)) + '</div>' +
          '</div></li>';
      }
      list.innerHTML = html;
    }

    document.getElementById('wbAlertCount').textContent = state.alerts.length
      ? '(' + state.alerts.length + ' 条)' : '';
    var clearBtn = document.getElementById('wbAlertClear');
    clearBtn.disabled = !state.alerts.length;
    var meta = document.getElementById('wbAlertMeta');
    if (window.__WB_ALERT_META__) {
      meta.textContent = '巡检时间 ' + window.__WB_ALERT_META__;
    } else {
      meta.textContent = '每日 18:30 自动巡检';
    }
  }

  /* ---------- 数据 ---------- */
  function load() {
    fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        state.alerts = (d && d.alerts) || [];
        state.loaded = true;
        if (d && d.meta && d.meta.checked_at) {
          window.__WB_ALERT_META__ = d.meta.checked_at.replace('T', ' ');
        }
        render();
      })
      .catch(function (e) {
        state.loaded = true;
        // 取不到数据时静默（不打扰），但铃铛可点击
        state.alerts = [];
        render();
      });
  }

  /* ---------- 启动 ---------- */
  function init() {
    // 必须等 DOM 就绪：#wbAlertSlot 在 header 里，需已解析
    if (!document.getElementById('wbAlertSlot') && !document.body) {
      setTimeout(init, 100);
      return;
    }
    state.readIds = readIds();
    buildUI();
    render();
    load();
    setInterval(load, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
