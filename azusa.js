/**
 * azusa —— azusa.wiki PT 保号（青龙面板）
 *
 * cron: 0 8 * * *
 *
 * 变量：AZUSA_COOKIE —— 站点 Cookie，多账号用 & 分隔
 *
 * 该站没有签到动作，脚本只访问一次首页确认登录态并取出魔力值，用于保号。
 */

'use strict';

const https = require('https');
const zlib = require('zlib');

const SITE_NAME = 'azusa';
const BASE = 'https://azusa.wiki';
const COOKIES = splitEnv(process.env.AZUSA_COOKIE || '');
const TIMEOUT = 20000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 2, maxFreeSockets: 2 });

function splitEnv(v) {
  return String(v).split('&').map(s => s.trim()).filter(Boolean);
}

function decode(buf, encoding) {
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'gzip') {
    try { return zlib.gunzipSync(buf).toString('utf8'); } catch (e) {}
  } else if (enc === 'deflate') {
    try { return zlib.inflateSync(buf).toString('utf8'); } catch (e) {
      try { return zlib.inflateRawSync(buf).toString('utf8'); } catch (e2) {}
    }
  } else if (enc === 'br' && typeof zlib.brotliDecompressSync === 'function') {
    try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch (e) {}
  }
  return buf.toString('utf8');
}

function request(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate',
      'user-agent': UA,
    }, headers);
    if (body !== null) {
      h['content-length'] = Buffer.byteLength(body);
    }
    const req = https.request(BASE + p, { method, headers: h, agent: AGENT }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: decode(Buffer.concat(chunks), res.headers['content-encoding']) }));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('请求超时')));
    if (body !== null) req.write(body);
    req.end();
  });
}

function pick(text, re, def = '') {
  const m = String(text == null ? '' : text).match(re);
  return m ? (m[1] !== undefined ? m[1] : m[0]) : def;
}

function pickAny(text, patterns, def = '未知') {
  for (const re of patterns) {
    const v = pick(text, re, '');
    if (v) return v.replace(/,/g, '');
  }
  return def;
}

async function notify(title, content) {
  content = String(content == null ? '' : content);
  console.log(`\n===== ${title} =====\n${content}`);

  const QL = (typeof QLAPI !== 'undefined' && QLAPI) || globalThis.QLAPI;
  if (QL) {
    for (const fn of ['systemNotify', 'notify']) {
      if (typeof QL[fn] !== 'function') continue;
      try {
        const r = await QL[fn]({ title, content });
        if (!r || r.code === undefined || r.code === 200) return;
        console.log(`[通知] 推送失败(code=${r.code})：${r.message || '未知原因'} —— 请到青龙「系统设置 → 通知配置」启用并测试一个渠道`);
        return;
      } catch (e) {
        console.log('[通知] 推送异常：' + e.message);
      }
    }
  }
  console.log('[通知] 未检测到青龙 QLAPI，已跳过推送');
}

async function runOne(cookie) {
  const r = await request('GET', '/index.php', {
    headers: {
      'accept-language': 'zh-CN,zh;q=0.9',
      'referer': BASE + '/',
      'cookie': cookie,
    },
  });
  if (r.status !== 200) return { err: `访问失败（status=${r.status}）` };
  if (/name="password"/.test(r.text)) return { err: '登录态已失效，请更新 AZUSA_COOKIE' };

  const name = pickAny(r.text, [
    /class=['"]?[^'"]*User_Name['"]?[^>]*>(?:<b>)?([^<]+)/,
    /userdetails\.php\?id=\d+[^>]*>(?:<b>)?([A-Za-z0-9_.\-]{2,32})</,
  ]);
  const moli = pickAny(r.text, [
    /魔力值\s*<\/font>[\s\S]{0,200}?[：:]\s*([\d.,]+)/,
    /魔力值[\s\S]{0,250}?[：:]\s*(?:<[^>]*>\s*)*([\d.,]+)/,
    /魔力值[\s\S]{0,250}?[\]】]\s*[：:]?\s*(?:<[^>]*>\s*)*([\d][\d.,]*)/,
  ]);

  return { status: '查询成功', body: [`【用户名：${name}】`, `【魔力值：${moli}】`] };
}

async function main() {
  if (!COOKIES.length) {
    await notify(SITE_NAME + ' 【配置缺失】', '请先在青龙环境变量配置 AZUSA_COOKIE。');
    return;
  }

  const results = [];
  for (let i = 0; i < COOKIES.length; i++) {
    try { results.push(await runOne(COOKIES[i])); }
    catch (e) { results.push({ err: '执行异常：' + e.message }); }
  }

  const many = results.length > 1;
  const hasErr = results.some(r => r.err);
  const okStatus = [...new Set(results.filter(r => !r.err).map(r => r.status))];
  const head = `${SITE_NAME} 【${many ? (!hasErr && okStatus.length === 1 ? okStatus[0] : '查询结果') : (hasErr ? '执行失败' : results[0].status)}】`;
  const blocks = results.map((r, i) => {
    const who = many ? `[账号${i + 1}]\n` : '';
    return who + (r.err ? r.err : r.body.join('\n'));
  });
  await notify(head, blocks.join('\n\n'));
}

main()
  .catch(e => console.error('脚本异常：' + ((e && e.message) || e)))
  .finally(() => AGENT.destroy());
