// Vercel Edge Function - 桥接前端手工交易请求 → GitHub API
// 部署到 laodinglab 仓库，与 GitHub Pages 共存

export const config = {
  runtime: 'edge',
};

const REPO_OWNER = "laodingtouzi";
const REPO_NAME = "laodinglab";

function toBase64(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function getGithubFile(token, path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const resp = await fetch(url, {
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "tri-market-api"
    }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub GET ${path} failed: ${resp.status}`);
  const data = await resp.json();
  return {
    content: JSON.parse(fromBase64(data.content)),
    sha: data.sha
  };
}

async function putGithubFile(token, path, content, sha, message) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const body = {
    message: message,
    content: toBase64(JSON.stringify(content, null, 2))
  };
  if (sha) body.sha = sha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "tri-market-api"
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok && resp.status !== 201) {
    const err = await resp.text().catch(() => '');
    throw new Error(`GitHub PUT ${path} failed: ${resp.status} ${err.slice(0, 200)}`);
  }
  return true;
}

function jsonResponse(obj, status) {
  status = status || 200;
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export default async function handler(request) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return jsonResponse({ error: "GITHUB_TOKEN not configured" }, 500);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  let body = {};
  try {
    body = await request.json();
  } catch (e) {}

  try {
    if (path === "/api/manual-sell" || path === "/manual-sell") {
      return await handleManualSell(body, token);
    } else if (path === "/api/manual-add" || path === "/manual-add") {
      return await handleManualAdd(body, token);
    } else if (path === "/api/manual-reduce" || path === "/manual-reduce") {
      return await handleManualReduce(body, token);
    } else if (path === "/api/delist" || path === "/delist" || path === "/") {
      return await handleDelist(body, token);
    } else {
      return jsonResponse({ error: "Unknown endpoint: " + path }, 404);
    }
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ========== 手工卖出 ==========
async function handleManualSell(body, token) {
  const { code, market } = body;
  if (!code || !market) return jsonResponse({ error: "Missing code or market" }, 400);

  const m = market.toUpperCase();
  const holdingsPath = `data/portfolio/holdings_${m}.json`;
  const postSellPath = `data/portfolio/post_sell_${m}.json`;

  const holdingsData = await getGithubFile(token, holdingsPath);
  if (!holdingsData || !holdingsData.content[code]) {
    return jsonResponse({ error: "Stock not found in holdings: " + code }, 404);
  }

  const h = holdingsData.content[code];
  const sellPrice = body.sell_price || h.current_price || 0;
  const reason = body.reason || body.sell_reason || "手工卖出";

  delete holdingsData.content[code];

  let postSellData = await getGithubFile(token, postSellPath);
  if (!postSellData) postSellData = { content: {}, sha: null };

  postSellData.content[code] = {
    name: h.name,
    market: m,
    sell_date: new Date().toISOString().split('T')[0],
    sell_price: sellPrice,
    total_return_when_sold: h.total_return || 0,
    hold_days: h.hold_days || 0,
    post_sell_analysis: reason,
    manual_sell: true,
  };

  await putGithubFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual sell: ${code}`);
  await putGithubFile(token, postSellPath, postSellData.content, postSellData.sha, `Manual sell post: ${code}`);

  return jsonResponse({ success: true, message: `${code} 手工卖出成功`, code });
}

// ========== 手工加仓 ==========
async function handleManualAdd(body, token) {
  const { code, market } = body;
  if (!code || !market) return jsonResponse({ error: "Missing code or market" }, 400);

  const sharesVal = parseInt(body.add_shares || body.shares, 10);
  const addPrice = parseFloat(body.add_price);
  if (!sharesVal || sharesVal <= 0 || isNaN(sharesVal) || isNaN(addPrice)) {
    return jsonResponse({ error: "Invalid shares or price" }, 400);
  }

  const m = market.toUpperCase();
  const holdingsPath = `data/portfolio/holdings_${m}.json`;

  const holdingsData = await getGithubFile(token, holdingsPath);
  if (!holdingsData || !holdingsData.content[code]) {
    return jsonResponse({ error: "Stock not found in holdings: " + code }, 404);
  }

  const h = holdingsData.content[code];
  const oldShares = h.shares || 0;
  const oldCost = oldShares * (h.entry_price || 0);
  const newCost = sharesVal * addPrice;
  const totalShares = oldShares + sharesVal;
  const avgPrice = totalShares > 0 ? (oldCost + newCost) / totalShares : 0;

  h.shares = totalShares;
  h.entry_price = Math.round(avgPrice * 100) / 100;
  h.market_value = totalShares * (h.current_price || addPrice);
  if (h.entry_price > 0) {
    h.total_return = Math.round(((h.current_price || addPrice) - h.entry_price) / h.entry_price * 10000) / 100;
  }
  h.cost = Math.round(totalShares * h.entry_price * 100) / 100;

  await putGithubFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual add: ${code} +${sharesVal}@${addPrice}`);

  return jsonResponse({
    success: true,
    message: `${code} 加仓 ${sharesVal} 股成功`,
    code,
    new_shares: totalShares,
    new_entry_price: h.entry_price,
  });
}

// ========== 手工减仓 ==========
async function handleManualReduce(body, token) {
  const { code, market } = body;
  if (!code || !market) return jsonResponse({ error: "Missing code or market" }, 400);

  const sharesVal = parseInt(body.reduce_shares || body.shares, 10);
  if (!sharesVal || sharesVal <= 0 || isNaN(sharesVal)) {
    return jsonResponse({ error: "Invalid shares" }, 400);
  }

  const m = market.toUpperCase();
  const holdingsPath = `data/portfolio/holdings_${m}.json`;
  const postSellPath = `data/portfolio/post_sell_${m}.json`;

  const holdingsData = await getGithubFile(token, holdingsPath);
  if (!holdingsData || !holdingsData.content[code]) {
    return jsonResponse({ error: "Stock not found in holdings: " + code }, 404);
  }

  const h = holdingsData.content[code];
  const oldShares = h.shares || 0;
  const newShares = Math.max(0, oldShares - sharesVal);

  if (newShares === 0) {
    let postSellData = await getGithubFile(token, postSellPath);
    if (!postSellData) postSellData = { content: {}, sha: null };

    postSellData.content[code] = {
      name: h.name,
      market: m,
      sell_date: new Date().toISOString().split('T')[0],
      sell_price: h.current_price || 0,
      total_return_when_sold: h.total_return || 0,
      hold_days: h.hold_days || 0,
      post_sell_analysis: "手工减仓至0",
      manual_sell: true,
    };
    delete holdingsData.content[code];

    await putGithubFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual reduce to 0: ${code}`);
    await putGithubFile(token, postSellPath, postSellData.content, postSellData.sha, `Manual reduce post: ${code}`);

    return jsonResponse({ success: true, message: `${code} 已清仓`, code, new_shares: 0 });
  }

  h.shares = newShares;
  h.market_value = newShares * (h.current_price || h.entry_price || 0);
  h.cost = Math.round(newShares * h.entry_price * 100) / 100;
  if (h.entry_price > 0) {
    h.total_return = Math.round(((h.current_price || h.entry_price) - h.entry_price) / h.entry_price * 10000) / 100;
  }

  await putGithubFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual reduce: ${code} -${sharesVal}`);

  return jsonResponse({
    success: true,
    message: `${code} 减仓 ${sharesVal} 股成功`,
    code,
    new_shares: newShares,
  });
}

// ========== 剔除（delist） ==========
async function handleDelist(body, token) {
  const { code, action } = body;
  if (!code) return jsonResponse({ error: "Missing code" }, 400);

  if (action === "add") {
    for (const m of ['CN', 'HK', 'US']) {
      const postSellPath = `data/portfolio/post_sell_${m}.json`;
      const data = await getGithubFile(token, postSellPath);
      if (data && data.content[code]) {
        delete data.content[code];
        await putGithubFile(token, postSellPath, data.content, data.sha, `Delist: ${code}`);
        return jsonResponse({ success: true, message: `${code} 已从观察清单移除` });
      }
    }
    return jsonResponse({ error: "Stock not found in post_sell" }, 404);
  }

  return jsonResponse({ error: "Invalid action" }, 400);
}
