// ===== 主报告增强：搜索 + 排序 + 云端同步 =====
(function() {
  'use strict';

  // ========== 1. 搜索栏 ==========
  function addSearchBar(sectionId, tableId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const h2 = section.querySelector('h2');
    if (!h2) return;
    if (section.querySelector('.table-search')) return;

    const searchDiv = document.createElement('div');
    searchDiv.className = 'table-search';
    searchDiv.style.cssText = 'margin: 8px 0 12px; max-width: 300px;';
    searchDiv.innerHTML = '<input type="text" placeholder="🔍 搜索代码或名称..." style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.9rem;" />';
    h2.parentNode.insertBefore(searchDiv, h2.nextSibling);

    const input = searchDiv.querySelector('input');
    input.addEventListener('input', function() {
      const kw = this.value.trim().toLowerCase();
      const table = document.getElementById(tableId);
      if (!table) return;
      table.querySelectorAll('tbody tr').forEach(row => {
        const code = row.getAttribute('data-code') || '';
        const nameCell = row.querySelector('td:nth-child(2)');
        const name = nameCell ? nameCell.textContent.toLowerCase() : '';
        row.style.display = (!kw || code.toLowerCase().includes(kw) || name.includes(kw)) ? '' : 'none';
      });
    });
  }

  // ========== 2. 排序按钮 ==========
  function addSortButtons(tableId, sortConfig) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const thead = table.querySelector('thead tr');
    if (!thead) return;
    const headers = thead.querySelectorAll('th');

    sortConfig.forEach(cfg => {
      if (cfg.colIndex >= headers.length) return;
      const th = headers[cfg.colIndex];
      if (th.querySelector('.sort-btn')) return;
      th.style.cursor = 'pointer';
      th.style.position = 'relative';

      const btn = document.createElement('span');
      btn.className = 'sort-btn';
      btn.innerHTML = ' ⇅';
      btn.style.cssText = 'color:#94a3b8;font-size:0.8rem;margin-left:4px;user-select:none;';
      th.appendChild(btn);

      let sortDir = 0;
      th.addEventListener('click', function() {
        sortDir = (sortDir + 1) % 3;
        headers.forEach((h, i) => {
          if (i !== cfg.colIndex) {
            const b = h.querySelector('.sort-btn');
            if (b) b.innerHTML = ' ⇅';
          }
        });
        if (sortDir === 0) {
          btn.innerHTML = ' ⇅';
          restoreOriginalOrder(table);
          return;
        }
        btn.innerHTML = sortDir === 1 ? ' ▲' : ' ▼';
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort((a, b) => {
          const aVal = cfg.extract(a);
          const bVal = cfg.extract(b);
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDir === 1 ? aVal - bVal : bVal - aVal;
          }
          const aStr = String(aVal).toLowerCase();
          const bStr = String(bVal).toLowerCase();
          if (aStr < bStr) return sortDir === 1 ? -1 : 1;
          if (aStr > bStr) return sortDir === 1 ? 1 : -1;
          return 0;
        });
        rows.forEach(row => tbody.appendChild(row));
      });
    });
  }

  function restoreOriginalOrder(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort((a, b) => {
      const ai = parseInt(a.getAttribute('data-original-index') || '0');
      const bi = parseInt(b.getAttribute('data-original-index') || '0');
      return ai - bi;
    });
    rows.forEach(row => tbody.appendChild(row));
  }

  function markOriginalOrder(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll('tbody tr').forEach((row, i) => {
      row.setAttribute('data-original-index', i);
    });
  }

  // ========== 3. 云端同步（同源域名，避免 CORS/超时） ==========
  const BASE_URL = 'https://laodinglab.com';
  const HOLDINGS_URLS = {
    CN: BASE_URL + '/data/portfolio/holdings_CN.json',
    HK: BASE_URL + '/data/portfolio/holdings_HK.json',
    US: BASE_URL + '/data/portfolio/holdings_US.json',
  };
  const POSTSELL_URLS = {
    CN: BASE_URL + '/data/portfolio/post_sell_CN.json',
    HK: BASE_URL + '/data/portfolio/post_sell_HK.json',
    US: BASE_URL + '/data/portfolio/post_sell_US.json',
  };

  function fmtInt(n) { try { return parseInt(n).toLocaleString(); } catch(e) { return String(n); } }
  function fmtPrice(n) { try { return parseFloat(n).toFixed(2); } catch(e) { return String(n); } }
  function fmtPct(n) { try { const v = parseFloat(n); return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; } catch(e) { return String(n); } }
  function fmtWan(n) { try { return (parseFloat(n) / 10000).toFixed(2); } catch(e) { return String(n); } }
  function retCls(n) { try { const v = parseFloat(n); return v > 0 ? 'up' : (v < 0 ? 'down' : ''); } catch(e) { return ''; } }

  function flashRow(row) {
    row.style.transition = 'background-color 0.3s';
    row.style.backgroundColor = '#dbeafe';
    setTimeout(() => { row.style.backgroundColor = ''; }, 1200);
  }

  function showSyncBanner(message, type) {
    if (document.getElementById('sync-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sync-banner';
    banner.style.cssText = 'position:fixed; top:60px; right:20px; z-index:3000; padding:10px 16px; border-radius:8px; font-size:0.85rem; box-shadow:0 4px 12px rgba(0,0,0,0.15); transition:opacity 0.5s; max-width:360px;';
    banner.style.background = type === 'success' ? '#16a34a' : (type === 'warn' ? '#ca8a04' : '#dc2626');
    banner.style.color = '#fff';
    banner.textContent = message;
    document.body.appendChild(banner);
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 500);
    }, 5000);
  }

  function syncHoldingsTable(cloudHoldings) {
    const table = document.getElementById('holdingsTable');
    if (!table) return { updated: 0, newItems: [], removed: [] };
    const tbody = table.querySelector('tbody');
    if (!tbody) return { updated: 0, newItems: [], removed: [] };

    let updated = 0;
    const seenCodes = new Set();
    const newItems = [];
    const removed = [];

    tbody.querySelectorAll('tr').forEach(row => {
      const code = row.getAttribute('data-code');
      if (!code) return;
      seenCodes.add(code);

      const cloud = cloudHoldings[code];
      if (!cloud) {
        if (!row.hasAttribute('data-sold')) {
          removed.push(code);
          row.setAttribute('data-sold', 'true');
          row.style.opacity = '0.4';
          row.style.textDecoration = 'line-through';
          const lastCell = row.cells[row.cells.length - 1];
          if (lastCell && !lastCell.querySelector('.sold-tag')) {
            lastCell.insertAdjacentHTML('beforeend', ' <span class="sold-tag" style="color:#dc2626;font-size:0.75rem;font-weight:600;margin-left:4px;">(已卖出)</span>');
          }
        }
        return;
      }

      const cells = row.querySelectorAll('td');
      if (cells.length < 14) return;
      let changed = false;

      const oldShares = cells[8].textContent.replace(/,/g, '').trim();
      const newShares = String(cloud.shares || 0);
      if (oldShares !== newShares) {
        cells[8].textContent = fmtInt(cloud.shares || 0);
        changed = true;
      }

      const oldMv = cells[9].textContent.trim();
      const newMv = fmtWan(cloud.market_value || 0);
      if (oldMv !== newMv) {
        cells[9].textContent = newMv;
        changed = true;
      }

      const oldRet = cells[10].textContent.trim();
      const newRet = fmtPct(cloud.total_return !== undefined ? cloud.total_return : (cloud.pnl_pct || 0));
      if (oldRet !== newRet) {
        cells[10].textContent = newRet;
        cells[10].className = 'num ' + retCls(cloud.total_return !== undefined ? cloud.total_return : (cloud.pnl_pct || 0));
        changed = true;
      }

      const oldPrice = cells[7].textContent.trim();
      const newPrice = fmtPrice(cloud.current_price || 0);
      if (oldPrice !== newPrice) {
        cells[7].textContent = newPrice;
        changed = true;
      }

      const oldStatusHtml = cells[3].innerHTML.trim();
      const status = cloud.status || 'H';
      let statusCls = '';
      if (status === 'H') statusCls = 'status-buy';
      else if (status === 'M↓') statusCls = 'status-sell';

      let momentumMarker = '';
      if (cloud.score_momentum_label === 'up') momentumMarker = ' <span style="color:#16a34a;font-size:0.75rem">↑</span>';
      else if (cloud.score_momentum_label === 'warning') momentumMarker = ' <span style="color:#ca8a04;font-size:0.75rem">▼</span>';
      else if (cloud.score_momentum_label === 'crashing') momentumMarker = ' <span style="color:#dc2626;font-size:0.75rem;font-weight:bold">🔴</span>';

      const newStatusHtml = (status === 'H' ? 'H' : status) + momentumMarker;
      if (oldStatusHtml.replace(/\s+/g, '') !== newStatusHtml.replace(/\s+/g, '')) {
        cells[3].innerHTML = newStatusHtml;
        cells[3].className = 'status-cell nowrap ' + statusCls;
        changed = true;
      }

      if (changed) {
        updated++;
        flashRow(row);
      }
    });

    Object.keys(cloudHoldings).forEach(code => {
      if (!seenCodes.has(code)) newItems.push(code);
    });

    return { updated, newItems, removed };
  }

  function syncPostSellTable(cloudPostSell) {
    const table = document.getElementById('postSellTable');
    if (!table) return { updated: 0, newItems: [], removed: [] };
    const tbody = table.querySelector('tbody');
    if (!tbody) return { updated: 0, newItems: [], removed: [] };

    let updated = 0;
    const seenCodes = new Set();
    const newItems = [];
    const removed = [];

    tbody.querySelectorAll('tr').forEach(row => {
      const code = row.getAttribute('data-code');
      if (!code) return;
      seenCodes.add(code);
      const cloud = cloudPostSell[code];
      if (!cloud) {
        removed.push(code);
        row.style.opacity = '0.4';
        row.style.textDecoration = 'line-through';
        return;
      }
    });

    Object.keys(cloudPostSell).forEach(code => {
      if (!seenCodes.has(code)) newItems.push(code);
    });

    return { updated, newItems, removed };
  }

  async function syncFromCloud() {
    try {
      const [cnH, hkH, usH, cnP, hkP, usP] = await Promise.all([
        fetch(HOLDINGS_URLS.CN + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
        fetch(HOLDINGS_URLS.HK + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
        fetch(HOLDINGS_URLS.US + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
        fetch(POSTSELL_URLS.CN + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
        fetch(POSTSELL_URLS.HK + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
        fetch(POSTSELL_URLS.US + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
      ]);

      const cloudHoldings = { ...(cnH || {}), ...(hkH || {}), ...(usH || {}) };
      const cloudPostSell = { ...(cnP || {}), ...(hkP || {}), ...(usP || {}) };

      const hResult = syncHoldingsTable(cloudHoldings);
      const psResult = syncPostSellTable(cloudPostSell);

      const totalUpdated = hResult.updated + psResult.updated;
      const totalNew = hResult.newItems.length + psResult.newItems.length;
      const totalRemoved = hResult.removed.length + psResult.removed.length;

      if (totalUpdated > 0 || totalNew > 0 || totalRemoved > 0) {
        let msg = '持仓数据已同步：';
        const parts = [];
        if (totalUpdated > 0) parts.push(totalUpdated + ' 条已更新');
        if (totalNew > 0) parts.push(totalNew + ' 只新买入');
        if (totalRemoved > 0) parts.push(totalRemoved + ' 只已卖出');
        msg += parts.join('，');
        showSyncBanner(msg, 'success');
        console.log('[Sync] 同步完成:', { holdings: hResult, postSell: psResult });
      } else {
        console.log('[Sync] 数据一致，无需更新');
      }
    } catch (e) {
      console.warn('[Sync] 同步异常:', e.message);
    }
  }

  // ========== 4. 初始化 ==========
  function init() {
    addSearchBar('holdings', 'holdingsTable');
    markOriginalOrder('holdingsTable');
    addSortButtons('holdingsTable', [
      { colIndex: 3, extract: r => r.querySelector('td:nth-child(4)')?.textContent?.trim() || '' },
      { colIndex: 10, extract: r => { const txt = r.querySelector('td:nth-child(11)')?.textContent?.trim() || '0%'; return parseFloat(txt.replace(/[+%]/g, '')) || 0; }},
      { colIndex: 11, extract: r => parseInt(r.querySelector('td:nth-child(12)')?.textContent?.trim() || '0') || 0 },
      { colIndex: 13, extract: r => r.querySelector('td:nth-child(14)')?.textContent?.trim() || '' },
    ]);

    addSearchBar('post-sell', 'postSellTable');
    markOriginalOrder('postSellTable');
    addSortButtons('postSellTable', [
      { colIndex: 5, extract: r => { const txt = r.querySelector('td:nth-child(6)')?.textContent?.trim() || '0%'; return parseFloat(txt.replace(/[+%]/g, '')) || 0; }},
      { colIndex: 6, extract: r => { const txt = r.querySelector('td:nth-child(7)')?.textContent?.trim() || '0%'; return parseFloat(txt.replace(/[+%]/g, '')) || 0; }},
      { colIndex: 7, extract: r => parseInt(r.querySelector('td:nth-child(8)')?.textContent?.trim() || '0') || 0 },
    ]);

    setTimeout(syncFromCloud, 500);
    setInterval(syncFromCloud, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
