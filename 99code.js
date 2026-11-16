/**
 * 99code —— gpt.api456.me 每日公益额度签到（青龙面板）
 * 任务名：new Env('99code签到')
 *
 * cron: 53 7 * * *
 *
 * 变量：CODE99_COOKIE —— UID=<用户ID>,session=<会话值>，多账号用 & 分隔
 *       UID：控制台 JSON.parse(localStorage.user).id
 *       session：Application → Cookies → session（或 document.cookie）
 *
 * 该站强制校验 New-Api-User，且必须与 Cookie 同属一个账号，缺失或不匹配都返回 401。
 */

'use strict';

const https = require('https');
const zlib = require('zlib');

const SITE_NAME = '99code';
const BASE = 'https://gpt.api456.me';
const ACCOUNTS = parseCookieEnv();
const UIDS = splitEnv(process.env.CODE99_UID || '');
const TIMEOUT = 20000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 2, maxFreeSockets: 2 });

function splitEnv(v) {
  return String(v).split('&').map(s => s.trim()).filter(Boolean);
}

function parseCookieEnv() {
  return splitEnv(process.env.CODE99_COOKIE || '').map(raw => {
    const m = raw.match(/(?:^|[,;&\s])UID\s*=\s*([^,;&\s]+)/i);
    const uid = m ? m[1].trim() : '';
    const cookie = raw
      .replace(/(?:^|[,;&\s])UID\s*=\s*[^,;&\s]+\s*[,;&]?/i, ' ')
      .replace(/^[\s,;&]+|[\s,;&]+$/g, '')
      .replace(/^cookie:\s*/i, '');
    return { uid, cookie };
  });
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
      'accept': 'application/json, text/plain, */*',
      'accept-encoding': 'gzip, deflate',
      'user-agent': UA,
    }, headers);
    if (body !== null) {
      h['content-type'] = h['content-type'] || 'application/json';
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

function baseHeaders(cookie, uid) {
  return {
    'accept-language': 'zh-CN,zh;q=0.9',
    'origin': BASE,
    'referer': BASE + '/dashboarda/',
    'New-Api-User': uid,
    'cookie': cookie,
  };
}

async function runOne(idx, cookie, uid) {
  if (!uid) {
    return { err: '没有用户 ID：请把 CODE99_COOKIE 写成 UID=<你的ID>,session=<会话值>。'
      + '该站强制校验 New-Api-User 且必须与 Cookie 属于同一账号，无法自动推导；'
      + 'ID 取法：登录站点后在控制台执行 JSON.parse(localStorage.user).id' };
  }
  const H = baseHeaders(cookie, uid);

  // 先领再查：领完的 summary 才是最新额度
  const c = await request('POST', '/api/portal/daily-public-quota/claim', { headers: H, body: '{}' });
  const claimedNow = c.status === 200 && /"success"\s*:\s*true/.test(c.text);

  const s = await request('GET', '/api/portal/summary', { headers: H });
  const ok = s.status === 200 && /"success"\s*:\s*true/.test(s.text);
  if (!ok) {
    // 三种 401 分开报，否则不知道该改哪个变量
    let why;
    if (/New-Api-User header not provided/i.test(s.text)) {
      why = '【未携带 New-Api-User】CODE99_COOKIE 里要带 UID=xxx 段';
    } else if (/New-Api-User does not match/i.test(s.text)) {
      why = `【UID=${uid} 与 Cookie 不是同一账号】请改成该 Cookie 所属用户的 ID`;
    } else if (/not logged in|access token/i.test(s.text)) {
      why = '【登录凭证已过期】请重新登录并导出新 Cookie 更新 CODE99_COOKIE';
    } else {
      why = s.text.slice(0, 120);
    }
    return { err: `登录态校验失败（status=${s.status}）：${why}` };
  }

  const name = pick(s.text, /"username"\s*:\s*"([^"]+)"/, '未知');
  const dq = pick(s.text, /"daily_compute_points"\s*:\s*"?([\d.]+)"?/, '未知');
  const du = pick(s.text, /"quota_used_compute_points"\s*:\s*"?([\d.]+)"?/, '未知');
  const dr = pick(s.text, /"quota_remaining_compute_points"\s*:\s*"?([\d.]+)"?/, '未知');
  const claimed = pick(s.text, /"claimed"\s*:\s*(true|false)/, '未知');

  const body = [
    `【用户名：${name}】`,
    `【今日额度：${dq}】`,
    `【今日已用：${du}】`,
    `【今日剩余：${dr}】`,
  ];
  if (claimedNow) return { status: '签到成功', body };
  if (claimed === 'true') return { status: '已签到', body };
  body.push(`【原因：${pick(c.text, /"message"\s*:\s*"([^"]*)"/, '领取接口未返回 success')}】`);
  return { status: '签到失败', body };
}

async function main() {
  if (!ACCOUNTS.length) {
    await notify(SITE_NAME + ' 【配置缺失】',
      '请先在青龙环境变量配置 CODE99_COOKIE，格式：UID=<用户ID>,session=<会话值>\n'
      + '例：CODE99_COOKIE="UID=7417,session=MTc5NDYzNDgzN3x..."');
    return;
  }
  const pairs = ACCOUNTS.map((a, i) => [a.cookie, String(a.uid || UIDS[i] || UIDS[0] || '').trim()]);
  if (!pairs.some(p => p[1])) {
    await notify(SITE_NAME + ' 【配置缺失】',
      'CODE99_COOKIE 里没找到 UID= 段。该站强制校验 New-Api-User 且必须与 Cookie 属于同一账号，无法自动推导。\n'
      + '请改成：CODE99_COOKIE="UID=<你的ID>,session=<会话值>"\n'
      + 'ID 取法：登录 gpt.api456.me 后在浏览器控制台执行 JSON.parse(localStorage.user).id');
    return;
  }

  const results = [];
  for (let i = 0; i < pairs.length; i++) {
    try { results.push(await runOne(i, pairs[i][0], pairs[i][1])); }
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
