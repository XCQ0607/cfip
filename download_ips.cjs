/**
 * IP 数据下载脚本
 * 功能：根据国家和地区自动抓取优选 IP JSON 并保存到本地
 * 策略：调用系统自带的 curl 命令，无需安装任何 Node 插件即可走代理
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- 配置区 ---
const BASE_URL = 'https://bestip.edtunnel.best';
const SAVE_DIR = path.join(__dirname, 'data');
const PROXY = '127.0.0.1:10808'; // 你的代理地址

// 从优选IP.js中提取的元数据
const REGIONS = ["Europe", "North America", "Asia Pacific", "Middle East", "Oceania", "South America"];
const COUNTRIES = [
    "DE", "NL", "SE", "FR", "US", "PL", "LT", "KR", "GB", "SG", "HK", "CA", "JP", "CH", "ES", "TR", "DK", "IT", "AT", "LV", "RO", "EE", "IN", "AU", "BG", "IL", "RU", "AM", "BR", "AE", "MD", "IE", "TW", "ID", "KZ", "HU", "GR", "SK", "OM"
];

const countryCodes = [...new Set(COUNTRIES)];

/**
 * 使用系统 curl 命令抓取 JSON
 */
function fetchWithCurl(url) {
    try {
        // -s: 静默模式
        // -L: 跟随重定向
        // -x: 使用代理
        const command = `curl -s -L -x http://${PROXY} "${url}"`;
        const output = execSync(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

        if (!output || output.trim() === "") {
            throw new Error("返回内容为空");
        }

        return JSON.parse(output);
    } catch (e) {
        if (e.message.includes("JSON")) {
            throw new Error("返回内容不是有效的 JSON (可能是被拦截或报404了)");
        }
        throw e;
    }
}

/**
 * 下载并保存文件
 */
async function download(endpoint, type, name) {
    const url = `${BASE_URL}/${endpoint}`;
    const filename = `${name}.json`;
    const filepath = path.join(SAVE_DIR, type, filename);

    const subDir = path.dirname(filepath);
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    console.log(`[正在下载] ${type === 'country' ? '国家' : '地区'}: ${name} ...`);

    try {
        const data = fetchWithCurl(url);
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(`[成功] 已保存: ${type}/${filename} (共 ${data.length} 条 IP)`);
    } catch (e) {
        console.error(`[失败] ${name}: ${e.message}`);
    }
}

/**
 * 主程序
 */
async function main() {
    console.log('=== 开始下载 IP 数据库 (CURL 代理模式) ===');
    console.log(`使用代理: ${PROXY}`);

    // 1. 下载地区数据
    console.log('\n--- 抓取地区数据 ---');
    for (const region of REGIONS) {
        const encodedRegion = encodeURIComponent(region);
        await download(`bestip/${encodedRegion}?regex=false`, 'regions', region);
        await new Promise(r => setTimeout(r, 500));
    }

    // 2. 下载国家数据
    console.log('\n--- 抓取国家数据 ---');
    for (const code of countryCodes) {
        await download(`country/${code}`, 'countries', code);
        await new Promise(r => setTimeout(r, 300));
    }

    // 3. 下载全球最佳与统计数据
    console.log('\n--- 抓取全球最佳与统计数据 ---');
    await download('bestip', '.', 'bestip');
    await download('api/stats', '.', 'stats');

    console.log('\n=== 下载任务已完成！ ===');
    console.log(`保存目录: ${SAVE_DIR}`);
}

main().catch(console.error);
