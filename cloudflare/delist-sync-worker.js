// Cloudflare Worker: 桥接前端删除请求 → GitHub API
// 部署后设置环境变量: GITHUB_TOKEN

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
  let code = url.searchParams.get('code');
  let action = url.searchParams.get('action') || 'add';

  try {
    const body = await request.json();
    if (body.code) code = body.code;
    if (body.action) action = body.action;
  } catch(e) {}

  if (!code || typeof code !== 'string') {
    return json({ error: 'Missing or invalid code' }, 400);
  }

  const GITHUB_TOKEN = typeof GITHUB_TOKEN !== 'undefined' ? GITHUB_TOKEN : '';
  if (!GITHUB_TOKEN) {
    return json({ error: 'GITHUB_TOKEN not configured in Worker' }, 500);
  }

  const apiUrl = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE_PATH;
  const headers = {
    'Authorization': 'token ' + GITHUB_TOKEN,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'laodinglab-delist-worker',
  };

  try {
    let excluded = {};
    let sha = null;
    const getResp = await fetch(apiUrl, { method: 'GET', headers: headers });

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
      return json({ error: 'GitHub GET failed(' + getResp.status + '): ' + errDetail }, 500);
    }

    if (action === 'add') {
      excluded[code] = { excluded_at: new Date().toISOString().split('T')[0], reason: 'manual_delist' };
    } else if (action === 'remove') {
      delete excluded[code];
    } else {
      return json({ error: 'Invalid action. Use add or remove' }, 400);
    }

    const contentStr = JSON.stringify(excluded, null, 2);
    const payload = { message: 'auto: ' + action + ' ' + code + ' to post_sell_excluded', content: b64encode(contentStr), sha: sha };
    const putResp = await fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(payload) });

    if (putResp.status === 200 || putResp.status === 201) {
      return json({ success: true, code: code, action: action, excluded_count: Object.keys(excluded).length });
    } else {
      const errText = await putResp.text();
      let errDetail = errText.slice(0, 500);
      try { const ej = JSON.parse(errText); errDetail = ej.message || errDetail; } catch(e) {}
      return json({ error: 'GitHub PUT failed(' + putResp.status + '): ' + errDetail }, 500);
    }
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
