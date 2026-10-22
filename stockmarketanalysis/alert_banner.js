/* 告警通知栏 · 选股模型主页（/stockmarketanalysis/）
 * 2026-10-22 r6 按 WB 规格书第四节 + 差异化方案实现：
 *   - 轮询 10 分钟（差异化第5点）+ Page Visibility API：页面不可见时暂停轮询
 *   - 数据获取 ?t=Date.now() + no-store（WB 4.4 两个细节不可省）
 *   - CSS 变量（不硬编码颜色）；面板 z-index 900 / max-height 70vh / <640px 自适应
 *   - 打开面板即视为已读（WB 4.1），localStorage 跨会话持久化
 */
(function () {
  'use strict';

  var DATA_URL = 'alerts.json';
  var POLL_MS = 10 * 60 * 1000;          // 差异化第5点：10 分钟轮询
  var LS_READ_KEY = 'tri_alert_read_ids_v1';
  var LS_READ_AT_KEY = 'tri_alert_read_at_v1';

  /* ---------- 样式（全部走页面 CSS 变量，不硬编码颜色） ---------- */
  function injectCss() {
    if (document.getElementById('triAlertCss')) return;
    var css = ''
      + '.tri-alert-wrap{position:relative;display:inline-flex;align-items:center;}'
      + '.tri-alert-btn{background:none;border:0.5px solid var(--border);border-radius:8px;'
      + '  cursor:pointer;font-size:16px;line-height:1;padding:5px 8px;position:relative;'
      + '  color:var(--text-secondary);transition:border-color .15s;}'
      + '.tri-alert-btn:hover{border-color:var(--border-hover);color:var(--text);}'
      + '.tri-alert-badge{position:absolute;top:-7px;right:-9px;min-width:17px;height:17px;'
      + '  border-radius:9px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;'
      + '  display:flex;align-items:center;justify-content:center;padding:0 4px;'
      + '  box-shadow:0 1px 3px rgba(0,0,0,.25);}'
      + '.tri-alert-panel{position:absolute;right:0;top:calc(100% + 10px);width:min(420px,92vw);'
      + '  max-height:70vh;overflow-y:auto;z-index:900;'
      + '  background:var(--bg-surface);border:0.5px solid var(--border);border-radius:12px;'
      + '  box-shadow:var(--shadow);padding:12px 14px;display:none;}'
      + '.tri-alert-panel.open{display:block;}'
      + '.tri-alert-panel h4{margin:0 0 8px;font-size:13px;color:var(--text);'
      + '  display:flex;justify-content:space-between;align-items:baseline;}'
      + '.tri-alert-panel h4 .tri-meta{font-size:11px;color:var(--text-muted);font-weight:400;}'
      + '.tri-alert-item{border-top:0.5px solid var(--border);padding:9px 2px;}'
      + '.tri-alert-item:first-of-type{border-top:0;}'
      + '.tri-alert-level{display:inline-block;font-size:10px;font-weight:700;border-radius:4px;'
      + '  padding:1px 6px;margin-right:6px;vertical-align:middle;}'
      + '.tri-alert-level.error{background:var(--danger);color:#fff;}'
      + '.tri-alert-level.warn{background:var(--warning);color:#fff;}'
      + '.tri-alert-level.info{background:var(--primary);color:#fff;}'
      + '.tri-alert-title{font-size:13px;font-weight:600;color:var(--text);}'
      + '.tri-alert-detail{font-size:12px;color:var(--text-secondary);margin-top:4px;line-height:1.5;}'
      + '.tri-alert-action{font-size:12px;color:var(--primary);margin-top:4px;}'
      + '.tri-alert-time{font-size:11px;color:var(--text-muted);margin-top:4px;}'
      + '.tri-alert-empty{text-align:center;color:var(--text-muted);font-size:13px;padding:18px 0;}'
      + '.tri-alert-fallback{position:fixed;right:18px;bottom:18px;z-index:900;}';
    var st = document.createElement('style');
    st.id = 'triAlertCss';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- 已读状态 ---------- */
  function getReadIds() {
    try { return JSON.parse(localStorage.getItem(LS_READ_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function markRead(ids) {
    try {
      localStorage.setItem(LS_READ_KEY, JSON.stringify(ids));
      localStorage.setItem(LS_READ_AT_KEY, String(Date.now()));
    } catch (e) { /* 隐私模式等场景静默失败 */ }
  }

  /* ---------- 渲染 ---------- */
  function fmtTs(ts) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts || '');
    return m ? (m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]) : (ts || '');
  }

  var wrap, btn, badge, panel;
  var lastUnread = 0;

  function buildDom() {
    injectCss();
    wrap = document.createElement('div');
    wrap.className = 'tri-alert-wrap';
    btn = document.createElement('button');
    btn.id = 'triAlertBtn';
    btn.className = 'tri-alert-btn';
    btn.title = '自动化任务告警';
    btn.innerHTML = '&#x1F514;'; // 🔔
    badge = document.createElement('span');
    badge.className = 'tri-alert-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);
    panel = document.createElement('div');
    panel.className = 'tri-alert-panel';
    wrap.appendChild(btn);
    wrap.appendChild(panel);

    // 优先挂到生成器预留的 #wbAlertSlot（导航同排）；找不到则退回 body 末尾独立浮层
    var slot = document.getElementById('wbAlertSlot');
    if (slot) {
      slot.appendChild(wrap);
    } else {
      var fb = document.createElement('div');
      fb.className = 'tri-alert-fallback';
      fb.appendChild(wrap);
      document.body.appendChild(fb);
    }

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var willOpen = !panel.classList.contains('open');
      panel.classList.add('open');
      // 打开面板即视为已读（WB 4.1）
      var ids = (lastData.alerts || []).map(function (a) { return a.id; });
      if (ids.length) markRead(ids);
      updateBadge(0);
      if (!willOpen) panel.classList.remove('open');
    });
    document.addEventListener('click', function (ev) {
      if (panel.classList.contains('open') && !wrap.contains(ev.target)) {
        panel.classList.remove('open');
      }
    });
  }

  function updateBadge(n) {
    lastUnread = n;
    if (!badge) return;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);   // 99+ 封顶（WB 4.1）
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  var lastData = { alerts: [], generated_at: '' };

  function renderPanel() {
    if (!panel) return;
    var alerts = lastData.alerts || [];
    var meta = lastData.meta || {};
    var html = '<h4>自动化任务告警<span class="tri-meta">巡检 ' +
      fmtTs(lastData.generated_at) + '</span></h4>';
    if (!alerts.length) {
      html += '<div class="tri-alert-empty">&#x2713; 当前没有告警</div>';
    } else {
      alerts.forEach(function (a) {
        var lv = a.level === 'error' ? 'error' : (a.level === 'warn' ? 'warn' : 'info');
        html += '<div class="tri-alert-item">'
          + '<span class="tri-alert-level ' + lv + '">' + (a.level || 'info').toUpperCase() + '</span>'
          + '<span class="tri-alert-title"></span>'
          + '<div class="tri-alert-detail"></div>'
          + (a.action ? '<div class="tri-alert-action">&rarr; </div>' : '')
          + '<div class="tri-alert-time">' + fmtTs(a.ts) + '</div>'
          + '</div>';
      });
    }
    panel.innerHTML = html;
    // 标题/明细/动作走 textContent 防注入
    var items = panel.querySelectorAll('.tri-alert-item');
    alerts.forEach(function (a, i) {
      var it = items[i];
      if (!it) return;
      it.querySelector('.tri-alert-title').textContent = a.title || '';
      it.querySelector('.tri-alert-detail').textContent = a.detail || '';
      var act = it.querySelector('.tri-alert-action');
      if (act && a.action) act.textContent = '→ ' + a.action;
    });
  }

  /* ---------- 数据获取（?t= + no-store，WB 4.4） ---------- */
  function fetchAlerts() {
    return fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        lastData = data;
        var read = getReadIds();
        var unread = (data.alerts || []).filter(function (a) {
          return read.indexOf(a.id) < 0;
        }).length;
        updateBadge(unread);
        renderPanel();
      })
      .catch(function () { /* 网络失败保持现状，下次轮询再试 */ });
  }

  /* ---------- 轮询：10 分钟 + Page Visibility（差异化第5点） ---------- */
  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      fetchAlerts().then(schedule);
    }, POLL_MS);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (timer) clearTimeout(timer);   // 页面不可见：暂停轮询
    } else {
      fetchAlerts();                     // 回前台立即刷新一次
      schedule();
    }
  });

  function init() {
    buildDom();
    fetchAlerts().then(schedule);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
