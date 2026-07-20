// Netlify Function: Auto-sync excluded post-sell stocks to GitHub
// Endpoint: POST /.netlify/functions/update-excluded
// Body: { "code": "000001.SZ", "action": "add" | "remove" }

function b64encode(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

function b64decode(str) {
  return Buffer.from(str, 'base64').toString('utf-8');
}

export default async (request, context) => {
  // Only accept POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { code, action = 'add' } = body;

    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Read GitHub token from Netlify environment variables
    const GITHUB_TOKEN = Netlify.env?.get('GITHUB_TOKEN') || process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) {
      return new Response(JSON.stringify({ error: 'GITHUB_TOKEN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const repo = 'laodingtouzi/laodinglab-site';
    const filePath = 'stockmarketanalysis/config/post_sell_excluded.json';
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    const headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'laodinglab-stock-model'
    };

    // 1. Fetch existing file
    let excluded = {};
    let sha = null;
    const getResp = await fetch(apiUrl, { method: 'GET', headers });

    if (getResp.status === 200) {
      const data = await getResp.json();
      sha = data.sha;
      const rawContent = b64decode(data.content.replace(/\n/g, ''));
      excluded = JSON.parse(rawContent);
    } else if (getResp.status === 404) {
      // File doesn't exist yet, start with empty object
      excluded = {};
    } else {
      const errText = await getResp.text();
      return new Response(JSON.stringify({ error: 'GitHub GET failed', detail: errText.slice(0, 500) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Update in-memory object
    if (action === 'add') {
      excluded[code] = {
        excluded_at: new Date().toISOString().split('T')[0],
        reason: 'manual_delist'
      };
    } else if (action === 'remove') {
      delete excluded[code];
    } else {
      return new Response(JSON.stringify({ error: 'Invalid action. Use add or remove' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. Write back to GitHub
    const contentStr = JSON.stringify(excluded, null, 2);
    const payload = {
      message: `auto: ${action} ${code} to post_sell_excluded`,
      content: b64encode(contentStr),
      sha: sha
    };

    const putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload)
    });

    if (putResp.status === 200 || putResp.status === 201) {
      return new Response(JSON.stringify({
        success: true,
        code: code,
        action: action,
        excluded_count: Object.keys(excluded).length
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      const errText = await putResp.text();
      return new Response(JSON.stringify({ error: 'GitHub PUT failed', detail: errText.slice(0, 500) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
