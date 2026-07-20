// Cloudflare Worker: 桥接前端删除请求 → GitHub API
// 部署后设置环境变量: GITHUB_TOKEN
// 请求: POST /?action=add&code=000001.SZ
// 响应: { success: true/false, code, excluded_count, error? }

const REPO = 'laodingtouzi/laodinglab';
const FILE_PATH = 'config/post_sell_excluded.json';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    let code = url.searchParams.get('code');
    let action = url.searchParams.get('action') || 'add';

    // 也支持 JSON body
    try {
      const body = await request.json();
      if (body.code) code = body.code;
      if (body.action) action = body.action;
    } catch(e) {
      // ignore, use query params
    }

    if (!code || typeof code !== 'string') {
      return json({ error: 'Missing or invalid code' }, 400);
    }

    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) {
      return json({ error: 'GITHUB_TOKEN not configured in Worker' }, 500);
    }

    const apiUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
    const headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'laodinglab-delist-worker',
    };

    try {
      // 1. 读取现有文件
      let excluded = {};
      let sha = null;
      const getResp = await fetch(apiUrl, { method: 'GET', headers });

      if (getResp.status === 200) {
        const data = await getResp.json();
        sha = data.sha;
        excluded = JSON.parse(b64decode(data.content.replace(/\n/g, '')));
      } else if (getResp.status === 404) {
        excluded = {};
      } else {
        const errText = await getResp.text();
        let errDetail = errText.slice(0, 500);
        try { const ej = JSON.parse(errText); errDetail = ej.message || errDetail; } catch(e) {}
        return json({ error: `GitHub GET failed(${getResp.status}): ${errDetail}` }, 500);
      }

      // 2. 更新
      if (action === 'add') {
        excluded[code] = { excluded_at: new Date().toISOString().split('T')[0], reason: 'manual_delist' };
      } else if (action === 'remove') {
        delete excluded[code];
      } else {
        return json({ error: 'Invalid action. Use add or remove' }, 400);
      }

      // 3. 写回 GitHub
      const contentStr = JSON.stringify(excluded, null, 2);
      const payload = { message: `auto: ${action} ${code} to post_sell_excluded`, content: b64encode(contentStr), sha };
      const putResp = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(payload) });

      if (putResp.status === 200 || putResp.status === 201) {
        return json({ success: true, code, action, excluded_count: Object.keys(excluded).length });
      } else {
        const errText = await putResp.text();
        let errDetail = errText.slice(0, 500);
        try { const ej = JSON.parse(errText); errDetail = ej.message || errDetail; } catch(e) {}
        return json({ error: `GitHub PUT failed(${putResp.status}): ${errDetail}` }, 500);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}
