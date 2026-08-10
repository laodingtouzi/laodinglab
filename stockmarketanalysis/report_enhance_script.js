// ===== 主报告增强：搜索 + 排序 =====
(function() {
  'use strict';

  // ========== 1. 搜索栏 ==========
  function addSearchBar(sectionId, tableId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    const h2 = section.querySelector('h2');
    if (!h2) return;
    
    // 避免重复添加
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
      if (th.querySelector('.sort-btn')) return; // 已添加
      
      th.style.cursor = 'pointer';
      th.style.position = 'relative';
      
      const btn = document.createElement('span');
      btn.className = 'sort-btn';
      btn.innerHTML = ' ⇅';
      btn.style.cssText = 'color:#94a3b8;font-size:0.8rem;margin-left:4px;user-select:none;';
      th.appendChild(btn);
      
      let sortDir = 0; // 0=无, 1=升序, 2=降序
      
      th.addEventListener('click', function() {
        sortDir = (sortDir + 1) % 3;
        
        // 重置其他列
        headers.forEach((h, i) => {
          if (i !== cfg.colIndex) {
            const b = h.querySelector('.sort-btn');
            if (b) b.innerHTML = ' ⇅';
          }
        });
        
        if (sortDir === 0) {
          btn.innerHTML = ' ⇅';
          // 恢复原始顺序
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
    // 按 data-original-index 恢复
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

  // ========== 3. 初始化 ==========
  function init() {
    // 持有池
    addSearchBar('holdings', 'holdingsTable');
    markOriginalOrder('holdingsTable');
    addSortButtons('holdingsTable', [
      { colIndex: 3, extract: r => r.querySelector('td:nth-child(4)')?.textContent?.trim() || '' }, // 状态
      { colIndex: 10, extract: r => { // 盈亏%
        const txt = r.querySelector('td:nth-child(11)')?.textContent?.trim() || '0%';
        return parseFloat(txt.replace(/[+%]/g, '')) || 0;
      }},
      { colIndex: 11, extract: r => parseInt(r.querySelector('td:nth-child(12)')?.textContent?.trim() || '0') || 0 }, // 天数
      { colIndex: 13, extract: r => r.querySelector('td:nth-child(14)')?.textContent?.trim() || '' }, // 持仓质量
    ]);
    
    // 沽后池
    addSearchBar('post-sell', 'postSellTable');
    markOriginalOrder('postSellTable');
    addSortButtons('postSellTable', [
      { colIndex: 5, extract: r => { // 持有收益
        const txt = r.querySelector('td:nth-child(6)')?.textContent?.trim() || '0%';
        return parseFloat(txt.replace(/[+%]/g, '')) || 0;
      }},
      { colIndex: 6, extract: r => { // 沽后涨跌
        const txt = r.querySelector('td:nth-child(7)')?.textContent?.trim() || '0%';
        return parseFloat(txt.replace(/[+%]/g, '')) || 0;
      }},
      { colIndex: 7, extract: r => parseInt(r.querySelector('td:nth-child(8)')?.textContent?.trim() || '0') || 0 }, // 观察天数
    ]);
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
