// _worker.js - Cloudflare Pages 部署版本
// 彻底移除外部网络请求，仅读取本地数据文件

// ==================== 配置区域 ====================
const DEFAULT_USER_ID = '';
const DEFAULT_HOSTNAME = '';
const DEFAULT_ACCESS_KEY = '';
// ================================================

let clientId = DEFAULT_USER_ID;
let serverHost = DEFAULT_HOSTNAME;
let authKey = DEFAULT_ACCESS_KEY;
let path = '/?ed=2560';
let allowInsecure = '&allowInsecure=1';

export default {
    async fetch(request, env, ctx) {
        try {
            // 初始化环境变量 (Cloudflare Pages 环境)
            clientId = env.UUID || env.uuid || env.PASSWORD || env.pswd || DEFAULT_USER_ID;
            authKey = env.SECRET || DEFAULT_ACCESS_KEY;
            serverHost = env.DOMAIN || DEFAULT_HOSTNAME;

            const url = new URL(request.url);
            const pathname = url.pathname.toLowerCase();

            // 路由处理
            if (pathname === '/select' || pathname === `/${authKey}/select` || pathname === `/${clientId}/select`) {
                return await handleSelectPage(request, env);
            } else if (pathname === '/refresh') {
                const stats = await readLocalBackup(request, env, 'stats');
                return new Response(JSON.stringify({ success: true, stats, countries: [] }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } else if (pathname.match(/^\/ip\/[^\/]+$/)) {
                return await handleMultiApiIntegration(request, env, url);
            } else if (pathname.match(/^\/[a-z]{2}\/[^\/]+$/)) {
                return await handleCountryAPI(request, env, url);
            } else if (pathname.match(/^\/bestip\/[^\/]+$/)) {
                return await handleBestIPAPI(request, env, url);
            } else if (pathname.match(/^\/([^\/]+)\/[^\/]+$/) && !pathname.includes('/select') && !pathname.includes('/edit')) {
                return await handleRegionAPI(request, env, url);
            }

            return env.ASSETS.fetch(request);
        } catch (err) {
            return new Response(err.toString(), { status: 500 });
        }
    }
};

// ==================== 数据获取功能 ====================

async function readLocalBackup(request, env, type, name) {
    try {
        const baseUrl = new URL(request.url);
        let dataUrlPath = '';
        if (type === 'country') {
            dataUrlPath = `/data/countries/${name.toUpperCase()}.json`;
        } else if (type === 'region') {
            dataUrlPath = `/data/regions/${name}.json`;
        } else if (type === 'global') {
            dataUrlPath = `/data/bestip.json`;
        } else if (type === 'stats') {
            dataUrlPath = `/data/stats.json`;
        }

        if (dataUrlPath) {
            const assetRequest = new Request(new URL(dataUrlPath, baseUrl.origin).toString(), request);
            const response = await env.ASSETS.fetch(assetRequest);
            if (response.ok) {
                return await response.json();
            }
        }
    } catch (err) {
        console.error('Read local error:', err);
    }
    return null;
}

// 恢复第三方 API 抓取逻辑 (针对 /ip/ 路径)
async function fetchNodeData() {
    const dataSourceList = [
        { url: 'https://ipdb.api.030101.xyz/?type=bestcf&country=true', namePrefix: '优选数据源(1-' },
        { url: 'https://addressesapi.090227.xyz/CloudFlareYes', namePrefix: '优选数据源(2-' },
        { url: 'https://addressesapi.090227.xyz/ip.164746.xyz', namePrefix: '优选数据源(3-' },
        { url: 'https://ipdb.api.030101.xyz/?type=bestproxy&country=true', namePrefix: '优选代理源(1-' }
    ];

    let allResults = [];
    for (const source of dataSourceList) {
        try {
            const response = await fetch(source.url);
            if (response.ok) {
                const data = await response.text();
                const ipList = data.trim().split(/[\r\n]+/);
                ipList.forEach((item, index) => {
                    const ipParts = item.split('#');
                    const ip = ipParts[0].trim();
                    if (ip) {
                        let name = `${source.namePrefix}${index + 1})`;
                        if (ipParts.length > 1) name += `-${ipParts[1]}`;
                        allResults.push({ domain: ip, name: name });
                    }
                });
            }
        } catch (error) {
            console.error(`获取 ${source.url} 失败:`, error.message);
        }
    }
    return allResults;
}

async function fetchCountryBestIP(request, env, countryCode) {
    const localData = await readLocalBackup(request, env, 'country', countryCode);
    return Array.isArray(localData) ? localData : [];
}

async function fetchGlobalBestIP(request, env) {
    const localData = await readLocalBackup(request, env, 'global');
    return Array.isArray(localData) ? localData : [];
}

async function fetchStatsData(request, env) {
    const localData = await readLocalBackup(request, env, 'stats');
    return localData || {};
}

// ==================== 页面处理功能 ====================

async function handleMultiApiIntegration(request, env, url) {
    const pathParts = url.pathname.split('/');
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;

    try {
        const nodeData = await fetchNodeData();
        const serverList = [
            { domain: tempHostname, name: `节点-Worker` },
            { domain: "104.16.0.0", name: `节点-CF1` },
            { domain: "104.17.0.0", name: `节点-CF2` },
            { domain: "104.18.0.0", name: `节点-CF3` },
            { domain: "cf.090227.xyz", name: "三网自适应分流优选" },
            { domain: "ct.090227.xyz", name: "电信优选" },
            { domain: "cmcc.090227.xyz", name: "移动优选" },
            ...nodeData
        ];

        let configURL = serverList.map(item =>
            `vless://${tempUserId}@${item.domain}:443?encryption=none&security=tls&sni=${tempHostname}&fp=randomized&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}${allowInsecure}#${encodeURIComponent(item.name)}`
        ).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleCountryAPI(request, env, url) {
    const pathParts = url.pathname.split('/');
    const countryCode = pathParts[1].toUpperCase();
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;

    try {
        const ipData = await fetchCountryBestIP(request, env, countryCode);
        if (ipData.length === 0) return new Response(`Not found local data for ${countryCode}`, { status: 404 });

        let configURL = ipData.map(item =>
            `vless://${tempUserId}@${item.ip}:${item.port}?encryption=none&security=tls&sni=${tempHostname}&fp=randomized&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}&allowInsecure=1#${encodeURIComponent(countryCode + '-' + item.ip + '-' + item.port)}`
        ).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleBestIPAPI(request, env, url) {
    const pathParts = url.pathname.split('/');
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;

    try {
        const ipData = await fetchGlobalBestIP(request, env);
        if (ipData.length === 0) return new Response('Not found local global data', { status: 404 });

        let configURL = ipData.map(item => {
            const nodeName = `${item.ip}-${item.port}-${item.city || 'Unknown'}-${item.latency || 'Unknown'}`;
            return `vless://${tempUserId}@${item.ip}:${item.port}?encryption=none&security=${item.tls ? 'tls' : 'none'}&sni=${tempHostname}&fp=randomized&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}&allowInsecure=1#${encodeURIComponent(nodeName)}`;
        }).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleRegionAPI(request, env, url) {
    const pathParts = url.pathname.split('/');
    const region = pathParts[1];
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;

    try {
        let decodedRegion = region;
        try { decodedRegion = decodeURIComponent(region); } catch (e) { }
        const ipData = await readLocalBackup(request, env, 'region', decodedRegion);
        if (!ipData || ipData.length === 0) return new Response(`Not found local data for ${decodedRegion}`, { status: 404 });

        let configURL = ipData.map(item => {
            const nodeName = `${decodedRegion}-${item.city || 'Unknown'}-${item.latency || 'Unknown'}`;
            return `vless://${tempUserId}@${item.ip}:${item.port}?encryption=none&security=${item.tls ? 'tls' : 'none'}&sni=${tempHostname}&fp=randomized&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}&allowInsecure=1#${encodeURIComponent(nodeName)}`;
        }).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleSelectPage(request, env) {
    try {
        const statsData = await fetchStatsData(request, env);

        const cityToCountryCode = {
            'Frankfurt': 'DE', 'Stockholm': 'SE', 'Amsterdam': 'NL', 'Paris': 'FR',
            'Seoul': 'KR', 'Los Angeles': 'US', 'Warsaw': 'PL', 'London': 'GB',
            'San Jose': 'US', 'Helsinki': 'FI', 'Tokyo': 'JP', 'Singapore': 'SG',
            'Hong Kong': 'HK', 'Riga': 'LV', 'Fukuoka': 'JP', 'Ashburn': 'US',
            'Istanbul': 'TR', 'Toronto': 'CA', 'Madrid': 'ES', 'Portland': 'US',
            'Zurich': 'CH', 'Düsseldorf': 'DE', 'Seattle': 'US', 'Osaka': 'JP',
            'Bucharest': 'RO', 'Sofia': 'BG', 'Moscow': 'RU', 'Vienna': 'AT',
            'Chicago': 'US', 'Sydney': 'AU', 'Mumbai': 'IN', 'Milan': 'IT',
            'Newark': 'US', 'Buffalo': 'US', 'Tel Aviv': 'IL', 'Dallas': 'US',
            'Copenhagen': 'DK', 'Montréal': 'CA', 'São Paulo': 'BR', 'Taipei': 'TW'
        };

        const regions = statsData.byRegion ? Object.keys(statsData.byRegion) : [];
        const citiesFromStats = statsData.byCity ? Object.keys(statsData.byCity) : [];

        let cityOptions = citiesFromStats.map(city => {
            const code = cityToCountryCode[city];
            return code ? `<option value="${code}">${city} — ${code}</option>` : '';
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>网络加速配置工具</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #3b82f6; --primary-hover: #2563eb; --success: #10b981;
            --bg: #f8fafc; --card-bg: rgba(255, 255, 255, 0.9);
            --text-main: #1e293b; --text-muted: #64748b; --border: #e2e8f0;
            --shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; margin: 0; padding: 20px; background: linear-gradient(135deg, #f0f9ff 0%, #f1f5f9 100%); color: var(--text-main); min-height: 100vh; }
        .container { max-width: 850px; margin: 40px auto; background: var(--card-bg); padding: 40px; border-radius: 28px; box-shadow: var(--shadow); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.6); }
        h1 { text-align: center; color: var(--text-main); font-family: 'Outfit', sans-serif; font-size: 2.8rem; margin-bottom: 30px; display: flex; align-items: center; justify-content: center; gap: 16px; letter-spacing: -0.5px; }
        .stats-row { display: flex; gap: 20px; margin-bottom: 30px; }
        .stats-item { flex: 1; background: #fff; padding: 20px; border-radius: 20px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; position: relative; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .stats-item label { color: var(--text-muted); font-size: 0.85rem; font-weight: 500; margin: 0; }
        .stats-item strong { font-size: 1.5rem; color: var(--text-main); font-family: 'Outfit', sans-serif; }
        .tabs-nav { display: flex; gap: 12px; margin-bottom: 24px; padding: 8px; background: #e2e8f0; border-radius: 18px; }
        .tab-btn { flex: 1; padding: 12px; text-align: center; cursor: pointer; border-radius: 14px; font-weight: 600; color: var(--text-muted); transition: all 0.3s; border: none; background: none; font-size: 1rem; }
        .tab-btn.active { background: #fff; color: var(--primary); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .panel { display: none; }
        .panel.active { display: block; animation: slideUp 0.4s ease; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .card { padding: 30px; background: #fff; border-radius: 24px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .card h3 { margin-top: 0; font-family: 'Outfit', sans-serif; font-size: 1.4rem; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
        .field-group { margin-bottom: 24px; }
        .field-label { display: block; margin-bottom: 10px; font-weight: 700; font-size: 0.95rem; color: var(--text-main); }
        select, input[type="text"] { width: 100%; padding: 14px 20px; border: 2px solid var(--border); border-radius: 16px; box-sizing: border-box; font-family: inherit; font-size: 1rem; transition: all 0.2s; outline: none; background: #f8fafc; }
        select:focus, input[type="text"]:focus { border-color: var(--primary); background: #fff; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1); }
        .check-wrap { font-weight: 600; display: flex; align-items: center; cursor: pointer; margin-bottom: 16px; padding: 12px 18px; background: #f1f5f9; border-radius: 14px; }
        .check-wrap input { width: 20px; height: 20px; margin-right: 12px; }
        .submit-btn { background: var(--primary); color: white; border: none; padding: 18px 30px; border-radius: 18px; cursor: pointer; font-size: 1.1rem; font-weight: 700; width: 100%; transition: all 0.3s; box-shadow: 0 8px 16px rgba(59, 130, 246, 0.2); text-transform: uppercase; letter-spacing: 0.5px; }
        .submit-btn:hover { background: var(--primary-hover); transform: translateY(-3px); }
        .output { margin-top: 32px; padding: 24px; background: #1e293b; border-radius: 20px; border: 1px solid #334155; }
        .link-text { word-break: break-all; color: #38bdf8; font-size: 0.95rem; font-family: monospace; text-decoration: none; display: block; margin-bottom: 18px; max-height: 100px; overflow-y: auto; }
        .copy-trigger { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 10px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 8px; }
        .var-box { display: none; margin-top: 18px; padding: 20px; background: #fff; border: 1px solid var(--border); border-radius: 16px; flex-direction: column; gap: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1><span>🌐</span> 网络加速配置工具</h1>
        <div class="stats-row">
            <div class="stats-item"><label>本地节点总数</label><strong id="total-count">${statsData.total || 0}</strong></div>
            <div class="stats-item"><label>数据最后日期</label><strong id="sync-time" style="font-size: 1.1rem; margin-top: 6px;">${statsData.lastUpdate || '未知'}</strong></div>
        </div>
        <nav class="tabs-nav">
            <button class="tab-btn active" data-target="multi">基础整合</button>
            <button class="tab-btn" data-target="country">国家分流</button>
            <button class="tab-btn" data-target="region">地区优选</button>
        </nav>
        <div class="panel active" id="multi">
            <div class="card">
                <h3><span>📡</span> 基础节点整合模式</h3>
                <div class="field-group">
                    <label class="check-wrap"><input type="checkbox" id="m-b64"> 采用 Base64 协议编码</label>
                    <label class="check-wrap"><input type="checkbox" id="m-vars-toggle" onchange="toggleBox()"> 手动指定临时覆盖变量</label>
                    <div id="multi-vars" class="var-box">
                        <input type="text" id="m-uid" value="${clientId}" placeholder="覆盖 UUID">
                        <input type="text" id="m-host" value="${serverHost}" placeholder="覆盖 Hostname">
                        <input type="text" id="m-path" value="${path}" placeholder="自定义传输路径 Path">
                    </div>
                </div>
                <button class="submit-btn" onclick="buildMulti()">生成 VLESS 订阅链接</button>
                <div class="output" id="m-res" style="display:none;"><code class="link-text" id="m-link"></code><button class="copy-trigger" onclick="doCopy('m-link')">一键复制</button></div>
            </div>
        </div>
        <div class="panel" id="country">
            <div class="card">
                <h3><span>🌍</span> 国家角色分流</h3>
                <div class="field-group">
                    <label class="field-label">目标资源节点:</label>
                    <select id="c-select" multiple>${cityOptions}</select>
                </div>
                <div class="field-group"><label class="check-wrap"><input type="checkbox" id="c-b64"> 采用 Base64 协议编码</label></div>
                <button class="submit-btn" onclick="buildCountry()" style="background: var(--success);">生成分流链接</button>
                <div class="output" id="c-res" style="display:none;"><div id="c-links"></div></div>
            </div>
        </div>
        <div class="panel" id="region">
            <div class="card">
                <h3><span>🗺️</span> 逻辑区域优选</h3>
                <div class="field-group">
                    <label class="field-label">选择目标区域:</label>
                    <select id="r-select"><option value="">请指定优选区域</option>${regions.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
                </div>
                <div class="field-group"><label class="check-wrap"><input type="checkbox" id="r-b64"> 采用 Base64 协议编码</label></div>
                <button class="submit-btn" onclick="buildRegion()" style="background: #f59e0b;">生成区域链接</button>
                <div class="output" id="r-res" style="display:none;"><code class="link-text" id="r-link"></code><button class="copy-trigger" onclick="doCopy('r-link')">一键复制</button></div>
            </div>
        </div>
    </div>
    <script>
        const U_ID = '${authKey || clientId}'; 
        const S_HOST = '${serverHost}';
        function toggleBox() { const box = document.getElementById('multi-vars'); box.style.display = document.getElementById('m-vars-toggle').checked ? 'flex' : 'none'; }
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn, .panel').forEach(el => el.classList.remove('active'));
                btn.classList.add('active'); document.getElementById(btn.getAttribute('data-target')).classList.add('active');
            });
        });
        function buildMulti() {
            const base64 = document.getElementById('m-b64').checked;
            let url = window.location.origin + '/ip/' + U_ID;
            let query = []; if (base64) query.push('base64');
            if (document.getElementById('m-vars-toggle').checked) {
                const uid = document.getElementById('m-uid').value.trim();
                const host = document.getElementById('m-host').value.trim();
                const path = document.getElementById('m-path').value.trim();
                if (uid && uid !== U_ID) query.push('USER_ID=' + encodeURIComponent(uid));
                if (host && host !== S_HOST) query.push('HOSTNAME=' + encodeURIComponent(host));
                if (path) query.push('PATH=' + encodeURIComponent(path));
            }
            if (query.length) url += '?' + query.join('&');
            document.getElementById('m-link').textContent = url; document.getElementById('m-res').style.display = 'block';
        }
        function buildCountry() {
            const select = document.getElementById('c-select'); const items = Array.from(select.selectedOptions).map(o => o.value);
            const base64 = document.getElementById('c-b64').checked; if (!items.length) return alert('请选择区域');
            const box = document.getElementById('c-links'); box.innerHTML = '';
            items.forEach(c => {
                let url = window.location.origin + '/' + c + '/' + U_ID + (base64 ? '?base64' : '');
                const d = document.createElement('div'); d.style.marginBottom = '12px';
                d.innerHTML = \`<code class="link-text" style="display:inline-block;margin:0;width:calc(100% - 80px);">\${url}</code><button class="copy-trigger" style="padding:4px 10px;font-size:0.75rem;margin-left:10px;" onclick="navigator.clipboard.writeText('\${url}').then(()=>alert('已复制'))">复制</button>\`;
                box.appendChild(d);
            });
            document.getElementById('c-res').style.display = 'block';
        }
        function buildRegion() {
            const r = document.getElementById('r-select').value; if (!r) return alert('请选择区域');
            const base64 = document.getElementById('r-b64').checked;
            let url = window.location.origin + '/' + encodeURIComponent(r) + '/' + U_ID + (base64 ? '?base64' : '');
            document.getElementById('r-link').textContent = url; document.getElementById('r-res').style.display = 'block';
        }
        function doCopy(id) { navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => alert('已复制')); }
    </script>
</body>
</html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
        return new Response('Error rendering page: ' + e.message, { status: 500 });
    }
}
