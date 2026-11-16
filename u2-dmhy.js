/**
 * U2 动漫花园 —— u2.dmhy.org PT 签到（青龙面板）
 * 任务名：new Env('U2动漫花园签到')
 *
 * cron: 51 7 * * *
 *
 * 变量：U2_COOKIE —— 站点 Cookie，多账号用 & 分隔
 *
 * 签到页有表单才提交；没表单说明今天已签过，直接读页面结果。
 * 用户名 / 魔力值 / 连续签到从签到页取，站点没显示就省略该行。
 */

'use strict';

const https = require('https');
const zlib = require('zlib');

const SITE_NAME = 'U2动漫花园';
const BASE = 'https://u2.dmhy.org';
const COOKIES = splitEnv(process.env.U2_COOKIE || '');
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
    if (v) return v.replace(/,/g, '').trim();
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
  const H = {
    'accept-language': 'zh-CN,zh-TW;q=0.9,zh;q=0.8,en;q=0.7',
    'referer': BASE + '/showup.php',
    'cookie': cookie,
  };

  const page = await request('GET', '/showup.php', { headers: H });
  if (page.status !== 200) return { err: `获取签到页失败（status=${page.status}）` };

  const req = pick(page.text, /name="req" value="(.+)" \/><input type="hidden" name="h/);
  const Hash = pick(page.text, /name="hash" value="(.+)" \/><input type="hidden" name="f/);
  const form = pick(page.text, /name="form" value="(.+)"/);
  const captcha = pick(page.text, /type="submit" name="(.+)" v/);
  const captchaContent = pick(page.text, /" value="(.*)" \/><b/);
  const csrf = pick(page.text, /csrf-token" content="(.+)" \//);

  if (req) {
    const data = [
      '_csrf=' + encodeURIComponent(csrf),
      'message=' + encodeURIComponent('随缘啦，就是你啦'),
      'req=' + encodeURIComponent(req),
      'hash=' + encodeURIComponent(Hash),
      'form=' + encodeURIComponent(form),
      encodeURIComponent(captcha) + '=' + encodeURIComponent(captchaContent),
    ].join('&');
    await request('POST', '/showup.php?action=show', {
      headers: Object.assign({}, H, {
        'origin': BASE,
        'content-type': 'application/x-www-form-urlencoded',
      }),
      body: data,
    });
  }

  // 没提交就复用第 1 步的页面，省一次请求
  const result = req ? await request('GET', '/showup.php', { headers: H }) : page;
  const log = pick(result.text, /(感谢[^<]{0,60}|抱歉[^<]{0,60})/, '');
  const got = pick(result.text, /获得\s*(\d+)\s*魔力值/, '');
  const name = pickAny(result.text, [
    /class=['"]?[^'"]*User_Name['"]?[^>]*>(?:<b>)?([^<]+)/,
    /userdetails\.php\?id=\d+[^>]*>(?:<b>)?([A-Za-z0-9_.\-]{2,32})</,
  ]);
  const moli = pickAny(result.text, [
    /魔力值[\s\S]{0,120}?[：:]\s*(?:<[^>]*>\s*)*([\d.,]+)/,
    /mybonus\.php[^>]*>[\s\S]{0,40}?([\d.,]+)\s*</,
  ]);
  const days = pickAny(result.text, [
    /连续签到[^0-9]{0,20}(\d+)/,
    /连续\s*签到[^0-9]{0,30}(\d+)/,
  ], '');

  const body = [`【用户名：${name}】`, `【魔力值：${moli}】`];
  if (got) body.push(`【获得：${got} 魔力值】`);
  if (days) body.push(`【连续签到：${days} 天】`);

  if (!req) return { status: '已签到', body };
  if (/感谢/.test(log)) return { status: '签到成功', body };
  if (/抱歉|已经签到/.test(log)) return { status: '已签到', body };
  body.push(`【注意：${log || '未获取到签到结果'}】`);
  return { status: '签到失败', body };
}

async function main() {
  if (!COOKIES.length) {
    await notify(SITE_NAME + ' 【配置缺失】', '请先在青龙环境变量配置 U2_COOKIE。');
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
  const head = `${SITE_NAME} 【${many ? (!hasErr && okStatus.length === 1 ? okStatus[0] : '签到结果') : (hasErr ? '执行失败' : results[0].status)}】`;
  const blocks = results.map((r, i) => {
    const who = many ? `[账号${i + 1}]\n` : '';
    return who + (r.err ? r.err : r.body.join('\n'));
  });
  await notify(head, blocks.join('\n\n'));
}

main()
  .catch(e => console.error('脚本异常：' + ((e && e.message) || e)))
  .finally(() => AGENT.destroy());
