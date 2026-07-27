// Cloudflare Worker: 桥接前端手工交易请求 → GitHub API
// 端点: /        → 剔除 post_sell (原有功能)
// 端点: /manual-sell  → 手工卖出
// 端点: /manual-add   → 手工加仓
// 端点: /manual-reduce→ 手工减仓
// 环境变量: GITHUB_TOKEN

const REPO = 'laodingtouzi/laodinglab';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function b64encode(str) {
  // 使用 TextEncoder + 逐字节转 Base64，兼容中文
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64decode(str) {
  const binary = atob(str.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function json(obj, status) {
  status = status || 200;
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const GITHUB_TOKEN = typeof GITHUB_TOKEN !== 'undefined' ? GITHUB_TOKEN : '';
  if (!GITHUB_TOKEN) {
    return json({ error: 'GITHUB_TOKEN not configured in Worker' }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch(e) {}

  try {
    if (path === '/' || path === '') {
      return await handleDelist(body, GITHUB_TOKEN);
    } else if (path === '/manual-sell') {
      return await handleManualSell(body, GITHUB_TOKEN);
    } else if (path === '/manual-add') {
      return await handleManualAdd(body, GITHUB_TOKEN);
    } else if (path === '/manual-reduce') {
      return await handleManualReduce(body, GITHUB_TOKEN);
    } else {
      return json({ error: 'Unknown endpoint: ' + path }, 404);
    }
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ========== GitHub API 基础操作 ==========

async function ghGetFile(token, filePath) {
  const resp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + filePath, {
    method: 'GET',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'laodinglab-worker',
    }
  });
  if (resp.status === 404) {
    return { exists: false, content: null, sha: null };
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('GitHub GET ' + filePath + ' failed(' + resp.status + '): ' + text.slice(0, 200));
  }
  const data = await resp.json();
  return { exists: true, content: JSON.parse(b64decode(data.content)), sha: data.sha };
}

async function ghPutFile(token, filePath, contentObj, message) {
  // 先获取 sha
  let sha = null;
  try {
    const getResp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + filePath, {
      method: 'GET',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'laodinglab-worker',
      }
    });
    if (getResp.status === 200) {
      const d = await getResp.json();
      sha = d.sha;
    }
  } catch(e) {}

  const payload = {
    message: message,
    content: b64encode(JSON.stringify(contentObj, null, 2)),
  };
  if (sha) payload.sha = sha;

  const resp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + filePath, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'laodinglab-worker',
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok && resp.status !== 201) {
    const text = await resp.text();
    throw new Error('GitHub PUT ' + filePath + ' failed(' + resp.status + '): ' + text.slice(0, 200));
  }
  return true;
}

// ========== 原有功能：剔除 post_sell ==========

async function handleDelist(body, token) {
  const code = body.code;
  const action = body.action || 'add';
  if (!code || typeof code !== 'string') {
    return json({ error: 'Missing or invalid code' }, 400);
  }

  const FILE_PATH = 'config/post_sell_excluded.json';
  let excluded = {};
  let sha = null;

  const getResp = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE_PATH, {
    method: 'GET',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'laodinglab-worker',
    }
  });

  if (getResp.status === 200) {
    const data = await getResp.json();
    sha = data.sha;
    excluded = JSON.parse(b64decode(data.content.replace(/\n/g, '')));
  } else if (getResp.status !== 404) {
    const errText = await getResp.text();
    return json({ error: 'GitHub GET failed(' + getResp.status + '): ' + errText.slice(0, 500) }, 500);
  }

  if (action === 'add') {
    excluded[code] = { excluded_at: new Date().toISOString().split('T')[0], reason: 'manual_delist' };
  } else if (action === 'remove') {
    delete excluded[code];
  } else {
    return json({ error: 'Invalid action. Use add or remove' }, 400);
  }

  await ghPutFile(token, FILE_PATH, excluded, 'auto: ' + action + ' ' + code + ' to post_sell_excluded');
  return json({ success: true, code: code, action: action, excluded_count: Object.keys(excluded).length });
}

// ========== 手工卖出 ==========

async function handleManualSell(body, token) {
  const code = body.code;
  const market = body.market || 'CN';
  const sellReason = body.sell_reason || '';
  const sellDate = new Date().toISOString().split('T')[0];

  if (!code) return json({ error: 'Missing code' }, 400);

  const holdingsPath = 'data/portfolio/holdings_' + market + '.json';
  const postSellPath = 'data/portfolio/post_sell_' + market + '.json';

  // 读取 holdings
  const holdingsFile = await ghGetFile(token, holdingsPath);
  if (!holdingsFile.exists) {
    return json({ error: 'Holdings file not found: ' + holdingsPath }, 404);
  }
  let holdings = holdingsFile.content;

  // 读取 post_sell
  const postSellFile = await ghGetFile(token, postSellPath);
  let postSell = postSellFile.exists ? postSellFile.content : {};

  const h = holdings[code];
  if (!h) {
    return json({ error: 'Stock not found in holdings: ' + code }, 404);
  }

  // 构造 post_sell 记录
  const sellPrice = h.current_price || h.entry_price || 0;
  const totalReturn = h.total_return || 0;
  const holdDays = h.hold_days || 0;

  postSell[code] = {
    name: h.name,
    market: h.market,
    sell_date: sellDate,
    sell_price: sellPrice,
    total_return_when_sold: totalReturn,
    hold_days: holdDays,
    post_sell_return: 0,
    post_sell_analysis: '手工卖出' + (sellReason ? ' | ' + sellReason : ''),
    manual_sell: true,
  };

  // 从 holdings 移除
  delete holdings[code];

  // 写回
  await ghPutFile(token, holdingsPath, holdings, 'manual-sell: ' + code + ' from ' + market);
  await ghPutFile(token, postSellPath, postSell, 'manual-sell: add ' + code + ' to post_sell_' + market);

  return json({ success: true, message: '已手工卖出 ' + code, code: code });
}

// ========== 手工加仓 ==========

async function handleManualAdd(body, token) {
  const code = body.code;
  const market = body.market || 'CN';
  const addShares = parseInt(body.add_shares);
  const addPrice = parseFloat(body.add_price);

  if (!code) return json({ error: 'Missing code' }, 400);
  if (!addShares || addShares <= 0) return json({ error: 'Invalid add_shares' }, 400);
  if (!addPrice || addPrice <= 0) return json({ error: 'Invalid add_price' }, 400);

  const holdingsPath = 'data/portfolio/holdings_' + market + '.json';
  const holdingsFile = await ghGetFile(token, holdingsPath);
  if (!holdingsFile.exists) {
    return json({ error: 'Holdings file not found: ' + holdingsPath }, 404);
  }
  let holdings = holdingsFile.content;

  const h = holdings[code];
  if (!h) {
    return json({ error: 'Stock not found in holdings: ' + code }, 404);
  }

  const oldShares = h.shares || 0;
  const oldEntryPrice = h.entry_price || 0;
  const oldCost = oldShares * oldEntryPrice;
  const newCost = addShares * addPrice;
  const totalShares = oldShares + addShares;
  const newEntryPrice = totalShares > 0 ? (oldCost + newCost) / totalShares : addPrice;

  h.shares = totalShares;
  h.entry_price = Math.round(newEntryPrice * 100) / 100;
  h.market_value = totalShares * (h.current_price || addPrice);
  // 重新计算 total_return
  if (h.entry_price > 0) {
    h.total_return = Math.round(((h.current_price || addPrice) - h.entry_price) / h.entry_price * 10000) / 100;
  }

  await ghPutFile(token, holdingsPath, holdings, 'manual-add: ' + code + ' +' + addShares + ' @' + addPrice);

  return json({
    success: true,
    message: '已加仓 ' + code + ' ' + addShares + '股 @' + addPrice,
    code: code,
    new_shares: totalShares,
    new_entry_price: h.entry_price,
  });
}

// ========== 手工减仓 ==========

async function handleManualReduce(body, token) {
  const code = body.code;
  const market = body.market || 'CN';
  const reduceShares = parseInt(body.reduce_shares);

  if (!code) return json({ error: 'Missing code' }, 400);
  if (!reduceShares || reduceShares <= 0) return json({ error: 'Invalid reduce_shares' }, 400);

  const holdingsPath = 'data/portfolio/holdings_' + market + '.json';
  const holdingsFile = await ghGetFile(token, holdingsPath);
  if (!holdingsFile.exists) {
    return json({ error: 'Holdings file not found: ' + holdingsPath }, 404);
  }
  let holdings = holdingsFile.content;

  const h = holdings[code];
  if (!h) {
    return json({ error: 'Stock not found in holdings: ' + code }, 404);
  }

  const oldShares = h.shares || 0;
  const newShares = oldShares - reduceShares;

  if (newShares <= 0) {
    // 全部清仓，转为卖出
    const postSellPath = 'data/portfolio/post_sell_' + market + '.json';
    const postSellFile = await ghGetFile(token, postSellPath);
    let postSell = postSellFile.exists ? postSellFile.content : {};
    const sellDate = new Date().toISOString().split('T')[0];

    postSell[code] = {
      name: h.name,
      market: h.market,
      sell_date: sellDate,
      sell_price: h.current_price || h.entry_price || 0,
      total_return_when_sold: h.total_return || 0,
      hold_days: h.hold_days || 0,
      post_sell_return: 0,
      post_sell_analysis: '手工减仓至零，自动清仓',
      manual_sell: true,
    };
    delete holdings[code];

    await ghPutFile(token, holdingsPath, holdings, 'manual-reduce: sell out ' + code + ' from ' + market);
    await ghPutFile(token, postSellPath, postSell, 'manual-reduce: add ' + code + ' to post_sell_' + market);

    return json({ success: true, message: '已清仓 ' + code, code: code, new_shares: 0 });
  }

  // 部分减仓
  h.shares = newShares;
  h.market_value = newShares * (h.current_price || h.entry_price || 0);
  // entry_price 不变，total_return 按当前价重新计算
  if (h.entry_price > 0) {
    h.total_return = Math.round(((h.current_price || h.entry_price) - h.entry_price) / h.entry_price * 10000) / 100;
  }

  await ghPutFile(token, holdingsPath, holdings, 'manual-reduce: ' + code + ' -' + reduceShares + ' shares');

  return json({
    success: true,
    message: '已减仓 ' + code + ' ' + reduceShares + '股',
    code: code,
    new_shares: newShares,
  });
}
