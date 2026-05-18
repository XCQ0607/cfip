// front.js - VLESS 配置界面与数据提取逻辑
// 仅包含 UI 界面和基础 API 逻辑

// ==================== 配置区域 ====================
// 如果环境变量存在则优先使用环境变量
const DEFAULT_USER_ID = '';
const DEFAULT_HOSTNAME = '';
const DEFAULT_ACCESS_KEY = ''; // 默认访问密钥
// ================================================

// 基础变量初始化
let clientId = DEFAULT_USER_ID;
let serverHost = DEFAULT_HOSTNAME;
let authKey = DEFAULT_ACCESS_KEY;
let path = '/?ed=2560';
let allowInsecure = '&allowInsecure=1';

export default {
    async fetch(request, env, ctx) {
        try {
            // 初始化环境变量
            clientId = env.UUID || env.uuid || env.PASSWORD || env.pswd || DEFAULT_USER_ID;
            authKey = env.SECRET || DEFAULT_ACCESS_KEY;
            serverHost = env.DOMAIN || DEFAULT_HOSTNAME;

            const url = new URL(request.url);
            const pathname = url.pathname.toLowerCase();

            // 路由处理
            if (pathname === '/select' || pathname === `/${authKey}/select` || pathname === `/${clientId}/select`) {
                return await handleSelectPage(request);
            } else if (pathname === '/refresh') {
                return await handleRefreshData(request);
            } else if (pathname.match(/^\/ip\/[^\/]+$/)) {
                return await handleMultiApiIntegration(request, url);
            } else if (pathname.match(/^\/[a-z]{2}\/[^\/]+$/)) {
                // 国家API模式 (例如 /US/uuid)
                return await handleCountryAPI(request, url);
            } else if (pathname.match(/^\/bestip\/[^\/]+$/)) {
                // 全球最佳IP API
                return await handleBestIPAPI(request, url);
            } else if (pathname.match(/^\/([^\/]+)\/[^\/]+$/) && !pathname.includes('/select') && !pathname.includes('/edit')) {
                // 地区API模式
                return await handleRegionAPI(request, url);
            }

            return new Response('VLESS Front-end Service. Use /select to access the configuration tool.', { status: 200 });
        } catch (err) {
            return new Response(err.toString(), { status: 500 });
        }
    }
};

// ==================== API数据获取功能 ====================

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

async function readLocalBackup(type, name) {
    try {
        if (typeof process === 'undefined' || !process.cwd) return null;
        let fs, pathMod;
        try {
            fs = await import('node:fs/promises');
            pathMod = await import('node:path');
        } catch (e) {
            try {
                fs = await import('fs/promises');
                pathMod = await import('path');
            } catch (e2) {
                return null;
            }
        }
        let filePath = '';
        const dataDir = pathMod.join(process.cwd(), 'data');
        if (type === 'country') {
            filePath = pathMod.join(dataDir, 'countries', `${name.toUpperCase()}.json`);
        } else if (type === 'region') {
            filePath = pathMod.join(dataDir, 'regions', `${name}.json`);
        } else if (type === 'global') {
            filePath = pathMod.join(dataDir, 'bestip.json');
        } else if (type === 'stats') {
            filePath = pathMod.join(dataDir, 'stats.json');
        }
        if (filePath && await fs.access(filePath).then(() => true).catch(() => false)) {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) { }
    return null;
}

async function fetchCountryBestIP(countryCode) {
    try {
        const url = `https://bestip.edtunnel.best/country/${countryCode}`;
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
    } catch (error) { }
    const localData = await readLocalBackup('country', countryCode);
    return Array.isArray(localData) ? localData : [];
}

async function fetchGlobalBestIP() {
    try {
        const url = 'https://bestip.edtunnel.best/bestip';
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
    } catch (error) { }
    const localData = await readLocalBackup('global');
    return Array.isArray(localData) ? localData : [];
}

async function fetchStatsData() {
    console.log('--- 开始请求统计数据 ---');
    try {
        const url = 'https://bestip.edtunnel.best/api/stats';
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        console.log(`Stats API 响应状态: ${response.status} ${response.statusText}`);
        if (response.ok) {
            const data = await response.json();
            console.log('Stats 数据解析成功:', JSON.stringify(data).substring(0, 100) + '...');
            if (data && typeof data === 'object') return data;
        } else {
            const errorText = await response.text();
            console.error(`Stats API 请求失败, 详情: ${errorText}`);
        }
    } catch (error) {
        console.error('获取统计数据发生异常:', error.message);
    }
    console.log('尝试读取本地 Stats 备份...');
    const localData = await readLocalBackup('stats');
    return localData || {};
}

async function fetchCountryList() {
    console.log('--- 开始请求国家列表 ---');
    try {
        const url = 'https://bestip.edtunnel.best/country';
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        console.log(`Country API 响应状态: ${response.status} ${response.statusText}`);
        if (response.ok) {
            const data = await response.json();
            console.log(`获取到 ${data.length} 个国家记录`);
            return Array.isArray(data) ? data : [];
        }
    } catch (error) {
        console.error('获取国家列表发生异常:', error.message);
    }
    return [];
}

// ==================== 页面处理功能 ====================

async function handleMultiApiIntegration(request, url) {
    const pathParts = url.pathname.split('/');
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;
    const tempFp = url.searchParams.get('fp') || 'chrome';

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
            `vless://${tempUserId}@${item.domain}:443?encryption=none&security=tls&sni=${tempHostname}&fp=${tempFp}&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}${allowInsecure}#${encodeURIComponent(item.name)}`
        ).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleCountryAPI(request, url) {
    const pathParts = url.pathname.split('/');
    const countryCode = pathParts[1].toUpperCase();
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;
    const tempFp = url.searchParams.get('fp') || 'chrome';

    try {
        const ipData = await fetchCountryBestIP(countryCode);
        if (ipData.length === 0) return new Response(`Not found`, { status: 404 });

        let configURL = ipData.map(item =>
            `vless://${tempUserId}@${item.ip}:${item.port}?encryption=none&security=tls&sni=${tempHostname}&fp=${tempFp}&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}&allowInsecure=1#${encodeURIComponent(countryCode + '-' + item.ip + '-' + item.port)}`
        ).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleBestIPAPI(request, url) {
    const pathParts = url.pathname.split('/');
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;
    const tempFp = url.searchParams.get('fp') || 'chrome';

    try {
        const ipData = await fetchGlobalBestIP();
        if (ipData.length === 0) return new Response('Not found', { status: 404 });

        let configURL = ipData.map(item => {
            const nodeName = `${item.ip}-${item.port}-${item.city || 'Unknown'}-${item.latency || 'Unknown'}`;
            return `vless://${tempUserId}@${item.ip}:${item.port}?encryption=none&security=${item.tls ? 'tls' : 'none'}&sni=${tempHostname}&fp=${tempFp}&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}&allowInsecure=1#${encodeURIComponent(nodeName)}`;
        }).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function handleRegionAPI(request, url) {
    const pathParts = url.pathname.split('/');
    const region = pathParts[1];
    const requestedId = pathParts[2];
    if (requestedId !== clientId && requestedId !== authKey) return new Response('Unauthorized', { status: 401 });

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const useRegex = url.searchParams.has('regex');
    const tempUserId = url.searchParams.get('USER_ID') || clientId;
    const tempHostname = url.searchParams.get('HOSTNAME') || serverHost;
    const tempPath = url.searchParams.get('PATH') || path;
    const tempFp = url.searchParams.get('fp') || 'chrome';

    try {
        const ipData = await fetchRegionBestIP(region, useRegex);
        if (ipData.length === 0) return new Response(`Not found`, { status: 404 });

        let configURL = ipData.map(item => {
            const nodeName = `${region}-${item.city || 'Unknown'}-${item.latency || 'Unknown'}`;
            return `vless://${tempUserId}@${item.ip}:${item.port}?encryption=none&security=${item.tls ? 'tls' : 'none'}&sni=${tempHostname}&fp=${tempFp}&type=ws&host=${tempHostname}&path=${encodeURIComponent(tempPath)}&allowInsecure=1#${encodeURIComponent(nodeName)}`;
        }).join('\n');

        if (isBase64) configURL = btoa(configURL);
        return new Response(configURL, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
    }
}

async function fetchRegionBestIP(region, useRegex) {
    let decodedRegion = region;
    try { decodedRegion = decodeURIComponent(region); } catch (e) { }
    try {
        const encodedRegion = encodeURIComponent(decodedRegion);
        let url = `https://bestip.edtunnel.best/bestip/${encodedRegion}`;
        if (useRegex) url += '?regex=true';
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
    } catch (error) { }
    const localData = await readLocalBackup('region', decodedRegion);
    return Array.isArray(localData) ? localData : [];
}

async function handleRefreshData(request) {
    console.log('触发后端数据同步更新...');
    try {
        const [stats, countries] = await Promise.all([
            fetchStatsData(),
            fetchCountryList()
        ]);
        console.log(`同步完成: 统计项 ${stats ? '已获取' : '为空'}, 国家数 ${countries.length}`);
        return new Response(JSON.stringify({ success: true, stats, countries }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error('handleRefreshData 发生错误:', e.message);
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleSelectPage(request) {
    try {
        const [statsData, countryListData] = await Promise.all([
            fetchStatsData(),
            fetchCountryList()
        ]);

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

        // 整合数据：如果 stats 中没有城市，尝试使用独立的国家列表供选择
        let cityOptions = citiesFromStats.map(city => {
            const code = cityToCountryCode[city];
            return code ? `<option value="${code}">${city} — ${code}</option>` : '';
        }).join('');

        if (!cityOptions && countryListData.length > 0) {
            cityOptions = countryListData.map(item =>
                `<option value="${item.code}">${item.name || item.code} — ${item.code}</option>`
            ).join('');
        }

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>网络加速配置工具</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --success: #10b981;
            --bg: #f8fafc;
            --card-bg: rgba(255, 255, 255, 0.9);
            --text-main: #1e293b;
            --text-muted: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        }

        body { 
            font-family: 'Inter', sans-serif; 
            line-height: 1.6; 
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #f0f9ff 0%, #f1f5f9 100%);
            color: var(--text-main);
            min-height: 100vh;
        }

        .container { 
            max-width: 850px; 
            margin: 40px auto; 
            background: var(--card-bg); 
            padding: 40px; 
            border-radius: 28px; 
            box-shadow: var(--shadow);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.6);
        }

        h1 { 
            text-align: center; 
            color: var(--text-main); 
            font-family: 'Outfit', sans-serif;
            font-size: 2.8rem;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            letter-spacing: -0.5px;
        }

        .stats-row {
            display: flex;
            gap: 20px;
            margin-bottom: 30px;
        }

        .stats-item {
            flex: 1;
            background: #fff;
            padding: 20px;
            border-radius: 20px;
            border: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 4px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
        }

        .stats-item label { color: var(--text-muted); font-size: 0.85rem; font-weight: 500; margin: 0; }
        .stats-item strong { font-size: 1.5rem; color: var(--text-main); font-family: 'Outfit', sans-serif; }

        .refresh-trigger {
            background: var(--primary);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 16px;
            cursor: pointer;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            align-self: center;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        .refresh-trigger:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4); background: var(--primary-hover); }
        .refresh-trigger:active { transform: translateY(0); }
        .refresh-trigger.loading svg { animation: spin 1s linear infinite; }

        @keyframes spin { 100% { transform: rotate(360deg); } }

        .tabs-nav { 
            display: flex; 
            gap: 12px;
            margin-bottom: 24px; 
            padding: 8px;
            background: #e2e8f0;
            border-radius: 18px;
        }

        .tab-btn { 
            flex: 1;
            padding: 12px; 
            text-align: center;
            cursor: pointer; 
            border-radius: 14px;
            font-weight: 600;
            color: var(--text-muted);
            transition: all 0.3s;
            border: none;
            background: none;
            font-size: 1rem;
        }

        .tab-btn.active { 
            background: #fff; 
            color: var(--primary);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        .panel { display: none; }
        .panel.active { display: block; animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1); }

        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .card { 
            padding: 30px; 
            background: #fff;
            border-radius: 24px;
            border: 1px solid var(--border);
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .card h3 { 
            margin-top: 0; 
            font-family: 'Outfit', sans-serif;
            font-size: 1.4rem;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .field-group { margin-bottom: 24px; }
        .field-label { display: block; margin-bottom: 10px; font-weight: 700; font-size: 0.95rem; color: var(--text-main); }

        select, input[type="text"] { 
            width: 100%; 
            padding: 14px 20px; 
            border: 2px solid var(--border); 
            border-radius: 16px; 
            box-sizing: border-box; 
            font-family: inherit;
            font-size: 1rem;
            transition: all 0.2s;
            outline: none;
            background: #f8fafc;
        }
        select:focus, input[type="text"]:focus { border-color: var(--primary); background: #fff; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1); }

        .check-wrap { 
            font-weight: 600; 
            display: flex; 
            align-items: center;
            cursor: pointer;
            margin-bottom: 16px;
            padding: 12px 18px;
            background: #f1f5f9;
            border-radius: 14px;
            transition: background 0.2s;
        }
        .check-wrap:hover { background: #e2e8f0; }
        .check-wrap input { width: 20px; height: 20px; margin-right: 12px; border-radius: 6px; }

        .submit-btn { 
            background: var(--primary); 
            color: white; 
            border: none; 
            padding: 18px 30px; 
            border-radius: 18px; 
            cursor: pointer; 
            font-size: 1.1rem; 
            font-weight: 700;
            width: 100%;
            transition: all 0.3s;
            box-shadow: 0 8px 16px rgba(59, 130, 246, 0.2);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .submit-btn:hover { background: var(--primary-hover); transform: translateY(-3px); box-shadow: 0 12px 24px rgba(59, 130, 246, 0.3); }

        .output { 
            margin-top: 32px; 
            padding: 24px; 
            background: #1e293b; 
            border-radius: 20px; 
            border: 1px solid #334155;
            position: relative;
        }

        .link-text { 
            word-break: break-all; 
            color: #38bdf8; 
            font-size: 0.95rem;
            font-family: 'Fira Code', monospace;
            text-decoration: none;
            display: block;
            margin-bottom: 18px;
            max-height: 100px;
            overflow-y: auto;
            padding-right: 10px;
        }

        .copy-trigger { 
            background: rgba(255,255,255,0.1); 
            color: #fff;
            border: 1px solid rgba(255,255,255,0.2);
            padding: 10px 24px; 
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .copy-trigger:hover { background: rgba(255,255,255,0.2); border-color: #fff; }

        .var-box { 
            display: none; 
            margin-top: 18px; 
            padding: 20px; 
            background: #fff;
            border: 1px solid var(--border);
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            animation: fadeIn 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1><span>🌐</span> 网络加速配置工具</h1>
        
        <div class="stats-row">
            <div class="stats-item">
                <label>发现节点总数</label>
                <strong id="total-count">${statsData.total || 0}</strong>
            </div>
            <div class="stats-item">
                <label>最后同步时间</label>
                <strong id="sync-time" style="font-size: 1.1rem; margin-top: 6px;">${statsData.lastUpdate || '未知'}</strong>
            </div>
            <button class="refresh-trigger" onclick="syncData()" id="sync-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                同步数据
            </button>
        </div>

        <nav class="tabs-nav">
            <button class="tab-btn active" data-target="multi">多API整合</button>
            <button class="tab-btn" data-target="country">国家分流</button>
            <button class="tab-btn" data-target="region">地区优选</button>
        </nav>

        <div class="panel active" id="multi">
            <div class="card">
                <h3><span style="background: #eff6ff; padding: 8px; border-radius: 10px;">📡</span> 全球多源整合模式</h3>
                <div class="field-group">
                    <label class="check-wrap"><input type="checkbox" id="m-b64"> 采用 Base64 协议编码</label>
                    <label class="check-wrap"><input type="checkbox" id="m-vars-toggle" onchange="toggleBox('multi')"> 手动指定临时覆盖变量</label>
                    <div id="multi-vars" class="var-box" style="display:none;">
                        <div>
                            <label class="field-label">覆盖 UUID:</label>
                            <input type="text" id="m-uid" value="${clientId}" placeholder="覆盖 UUID (可选)">
                        </div>
                        <div>
                            <label class="field-label">覆盖 Hostname:</label>
                            <input type="text" id="m-host" value="${serverHost}" placeholder="覆盖 Hostname (可选)">
                        </div>
                        <div>
                            <label class="field-label">传输路径 Path:</label>
                            <input type="text" id="m-path" value="${path}" placeholder="自定义传输路径 Path">
                        </div>
                        <div>
                            <label class="field-label">指纹 Fingerprint (fp):</label>
                            <select id="m-fp">
                                <option value="chrome" selected>chrome</option>
                                <option value="firefox">firefox</option>
                                <option value="safari">safari</option>
                                <option value="ios">ios</option>
                                <option value="android">android</option>
                                <option value="edge">edge</option>
                                <option value="360">360</option>
                                <option value="qq">qq</option>
                                <option value="random">random</option>
                                <option value="randomized">randomized</option>
                            </select>
                        </div>
                    </div>
                </div>
                <button class="submit-btn" onclick="buildMulti()">生成 VLESS 订阅链接</button>
                <div class="output" id="m-res" style="display:none;">
                    <code class="link-text" id="m-link"></code>
                    <button class="copy-trigger" onclick="doCopy('m-link')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        一键复制订阅
                    </button>
                </div>
            </div>
        </div>

        <div class="panel" id="country">
            <div class="card">
                <h3><span style="background: #ecfdf5; padding: 8px; border-radius: 10px;">🌍</span> 国家/组织定向分流</h3>
                <div class="field-group">
                    <label class="field-label">目标资源节点 (按住 Ctrl 多选):</label>
                    <select id="c-select" multiple>
                        ${cityOptions}
                    </select>
                </div>
                <div class="field-group">
                    <label class="check-wrap"><input type="checkbox" id="c-b64"> 采用 Base64 协议编码</label>
                </div>
                <button class="submit-btn" onclick="buildCountry()" style="background: var(--success);">生成国家分流链接</button>
                <div class="output" id="c-res" style="display:none;"><div id="c-links"></div></div>
            </div>
        </div>

        <div class="panel" id="region">
            <div class="card">
                <h3><span style="background: #fff7ed; padding: 8px; border-radius: 10px;">🗺️</span> 逻辑地理区域优选</h3>
                <div class="field-group">
                    <label class="field-label">选择目标物理区域:</label>
                    <select id="r-select">
                        <option value="">请指定优选区域</option>
                        ${regions.map(r => `<option value="${r}">${r}</option>`).join('')}
                    </select>
                </div>
                <div class="field-group">
                    <label class="check-wrap"><input type="checkbox" id="r-b64"> 采用 Base64 协议编码</label>
                    <label class="check-wrap"><input type="checkbox" id="r-regex"> 启用高性能正则匹配模式</label>
                </div>
                <button class="submit-btn" onclick="buildRegion()" style="background: #f59e0b;">生成区域分流链接</button>
                <div class="output" id="r-res" style="display:none;">
                    <code class="link-text" id="r-link"></code>
                    <button class="copy-trigger" onclick="doCopy('r-link')">一键复制订阅</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const U_ID = '${clientId}';
        const S_HOST = '${serverHost}';

        async function syncData() {
            const btn = document.getElementById('sync-btn');
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                const res = await fetch('/refresh');
                const data = await res.json();
                if (data.success) {
                    document.getElementById('total-count').textContent = data.stats.total || '0';
                    document.getElementById('sync-time').textContent = data.stats.lastUpdate || '刚刚';
                    
                    // 更新国家/城市列表
                    const cSelect = document.getElementById('c-select');
                    if (data.countries && data.countries.length > 0) {
                        cSelect.innerHTML = data.countries.map(item => 
                            '<option value="' + item.code + '">' + (item.name || item.code) + ' — ' + item.code + '</option>'
                        ).join('');
                    } else if (data.stats.byCity) {
                        // 回退到 stats 数据
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
                        cSelect.innerHTML = Object.keys(data.stats.byCity).map(city => {
                            const code = cityToCountryCode[city];
                            return code ? '<option value="' + code + '">' + city + ' — ' + code + '</option>' : '';
                        }).join('');
                    }

                    // 更新地区列表
                    if (data.stats.byRegion) {
                        const rSelect = document.getElementById('r-select');
                        const currentVal = rSelect.value;
                        rSelect.innerHTML = '<option value="">请指定优选区域</option>' + 
                            Object.keys(data.stats.byRegion).map(r => '<option value="' + r + '">' + r + '</option>').join('');
                        rSelect.value = currentVal;
                    }

                    btn.style.background = 'var(--success)';
                    setTimeout(() => btn.style.background = 'var(--primary)', 2000);
                }
            } catch (e) {
                alert('同步失败: ' + e.message);
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        }

        function toggleBox(prefix) {
            const toggle = document.getElementById(prefix === 'multi' ? 'm-vars-toggle' : '');
            const box = document.getElementById('multi-vars');
            box.style.display = toggle.checked ? 'flex' : 'none';
        }

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn, .panel').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.getAttribute('data-target')).classList.add('active');
            });
        });

        function buildMulti() {
            const base64 = document.getElementById('m-b64').checked;
            const vars = document.getElementById('m-vars-toggle').checked;
            let url = window.location.origin + '/ip/' + U_ID;
            let query = [];
            if (base64) query.push('base64');
            if (vars) {
                const uid = document.getElementById('m-uid').value.trim();
                const host = document.getElementById('m-host').value.trim();
                const path = document.getElementById('m-path').value.trim();
                const fp = document.getElementById('m-fp').value;
                if (uid && uid !== U_ID) query.push('USER_ID=' + encodeURIComponent(uid));
                if (host && host !== S_HOST) query.push('HOSTNAME=' + encodeURIComponent(host));
                if (path) query.push('PATH=' + encodeURIComponent(path));
                if (fp && fp !== 'chrome') query.push('fp=' + encodeURIComponent(fp));
            }
            if (query.length) url += '?' + query.join('&');
            const target = document.getElementById('m-link');
            target.textContent = url;
            document.getElementById('m-res').style.display = 'block';
        }

        function buildCountry() {
            const select = document.getElementById('c-select');
            const items = Array.from(select.selectedOptions).map(o => o.value);
            const base64 = document.getElementById('c-b64').checked;
            if (!items.length) return alert('尚未选择目标区域');
            const box = document.getElementById('c-links');
            box.innerHTML = '';
            items.forEach(c => {
                let url = window.location.origin + '/' + c + '/' + U_ID + (base64 ? '?base64' : '');
                const d = document.createElement('div');
                d.style.marginBottom = '16px';
                d.innerHTML = \`<code class="link-text" style="display:inline-block; margin:0; width:calc(100% - 100px);">\${url}</code>
                               <button class="copy-trigger" style="padding:6px 12px; font-size:0.8rem; margin-left:10px;" onclick="navigator.clipboard.writeText('\${url}').then(()=>alert('已复制'))">复制</button>\`;
                box.appendChild(d);
            });
            document.getElementById('c-res').style.display = 'block';
        }

        function buildRegion() {
            const r = document.getElementById('r-select').value;
            if (!r) return alert('尚未指定优选区域');
            const base64 = document.getElementById('r-b64').checked;
            const regex = document.getElementById('r-regex').checked;
            let url = window.location.origin + '/' + r + '/' + U_ID;
            let query = [];
            if (base64) query.push('base64');
            if (regex) query.push('regex=true');
            if (query.length) url += '?' + query.join('&');
            const target = document.getElementById('r-link');
            target.textContent = url;
            document.getElementById('r-res').style.display = 'block';
        }

        function doCopy(id) {
            navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => alert('配置链接已安全复制到剪贴板'));
        }
    </script>
</body>
</html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
        return new Response('Error rendering page', { status: 500 });
    }
}
