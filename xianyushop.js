/**
 * 闲鱼接口 API 每日签到（青龙面板）
 *
 * cron: 0 8 * * *
 *
 * 变量：XIANYU_REFRESH_TOKEN —— 浏览器登录 api.xianyushop.shop 后控制台执行
 *       localStorage.getItem('api_refresh_token')，多账号用 & 分隔
 *
 * refresh_token 是轮换式的：每次续期都换发新值、旧的当场作废，所以必须把新值写进
 * /ql/data/token/xianyushop-token.json 供下次复用；存档写不进去就直接中止，避免白烧种子。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const BASE = 'https://api.xianyushop.shop';
const TOKENS = String(process.env.XIANYU_REFRESH_TOKEN || '').split('&').map(s => s.trim()).filter(Boolean);
const STATE_FILE = path.join(process.env.QL_DIR || '/ql', 'data', 'token', 'xianyushop-token.json');
const TIMEOUT = 20000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 2, maxFreeSockets: 2 });

const STATE = (() => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
})();

function saveState() {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(STATE, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.log('[存档] 写入失败：' + e.message);
  }
}

function ensureWritable() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.appendFileSync(STATE_FILE, '');
    return true;
  } catch (e) {
    return false;
  }
}

function decode(buf, encoding) {
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'gzip') {
    try { return zlib.gunzipSync(buf).toString('utf8'); } catch (e) {}
  } else if (enc === 'deflate') {
    try { return zlib.inflateSync(buf).toString('utf8'); } catch (e) {
      try { return zlib.inflateRawSync(buf).toString('utf8'); } catch (e2) {}
    }
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
      h['content-type'] = 'application/json';
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

function pick(text, re, def = '未知') {
  const m = String(text == null ? '' : text).match(re);
  return m ? (m[1] !== undefined ? m[1] : m[0]) : def;
}

function prevDay(d) {
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 86400000).toISOString().slice(0, 10);
}

function claims(t) {
  try {
    const seg = String(t || '').split('.')[1];
    if (!seg) return null;
    return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) { return null; }
}

function usable(t) {
  const c = claims(t);
  return !!(c && c.exp && c.exp * 1000 - Date.now() > 60000);
}

function accountKey(rt, idx) {
  const c = claims(rt);
  return c && c.sub ? 'u' + c.sub : 'i' + idx;
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

function isAuthFail(r) {
  if (r.status === 401 || r.status === 403) return true;
  return /"code"\s*:\s*40[12]\d\d/.test(r.text) || /请先登录|登录状态已失效|未登录|Unauthorized/i.test(r.text);
}

async function refreshAccess(rt) {
  try {
    const r = await request('POST', '/api/auth/refresh', { body: JSON.stringify({ refresh_token: rt }) });
    if (r.status === 200 && /"success"\s*:\s*true/.test(r.text)) {
      const token = pick(r.text, /"access_token"\s*:\s*"([^"]+)"/, '');
      if (token) return {
        token,
        refresh: pick(r.text, /"refresh_token"\s*:\s*"([^"]+)"/, '') || rt,
        username: pick(r.text, /"username"\s*:\s*"([^"]*)"/, ''),
      };
    }
    return { err: `${pick(r.text, /"code"\s*:\s*(\d+)/, 'HTTP' + r.status)} ${pick(r.text, /"message"\s*:\s*"([^"]*)"/, '')}`.trim() };
  } catch (e) {
    return { err: '请求失败：' + e.message };
  }
}

const RENEW_ERR = {};

function expiredHint(key) {
  const why = RENEW_ERR[key];
  return '登录态失效且无法续期' + (why ? `（服务端：${why}）` : '') + '：这条 refresh_token 已经被轮换或会话被清掉了。'
    + '重新登录 api.xianyushop.shop → 控制台 localStorage.getItem("api_refresh_token") → 更新 XIANYU_REFRESH_TOKEN，'
    + '复制完立刻关掉那个标签页（页面自动续期会把这条值轮换掉），再跑一次脚本即可。';
}

async function renew(key, seed) {
  const st = STATE[key] || {};
  const tries = [];
  if (st.refresh_token) tries.push(st.refresh_token);
  if (seed && seed !== st.refresh_token) tries.push(seed);
  for (const rt of tries) {
    const a = await refreshAccess(rt);
    if (a.err) { RENEW_ERR[key] = a.err; continue; }
    delete RENEW_ERR[key];
    STATE[key] = Object.assign({}, st, {
      access_token: a.token,
      refresh_token: a.refresh,
      username: a.username || st.username || '',
      saved_at: new Date().toISOString(),
    });
    saveState();
    console.log(`[续期] ${key} 已换新 token 并保存 → ${STATE_FILE}`);
    return a.token;
  }
  return '';
}

async function runOne(idx, seed) {
  const key = accountKey(seed, idx);
  const H = t => ({ 'Authorization': 'Bearer ' + t });

  let tok = (STATE[key] && usable(STATE[key].access_token)) ? STATE[key].access_token : '';
  if (!tok) tok = await renew(key, seed);
  if (!tok) return { err: expiredHint(key) };

  let r = await request('POST', '/api/personal/checkin', { headers: H(tok) });
  if (isAuthFail(r)) {
    tok = await renew(key, seed);
    if (!tok) return { err: expiredHint(key) };
    r = await request('POST', '/api/personal/checkin', { headers: H(tok) });
    if (isAuthFail(r)) return { err: expiredHint(key) };
  }
  if (r.status !== 200) return { err: `签到失败（status=${r.status}）：${r.text.slice(0, 120)}` };
  const msg = pick(r.text, /"message"\s*:\s*"([^"]*)"/);

  let reward = pick(r.text, /"reward_amount"\s*:\s*"?([0-9.]+)"?/, '');
  let balance = pick(r.text, /"balance"\s*:\s*"?([0-9.]+)"?/, '');
  let day = pick(r.text, /"checkin_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/, '');
  if (!reward || !balance || !day) {
    const [rt2, rb2] = await Promise.all([
      reward && day ? null : request('GET', '/api/personal/checkin/today', { headers: H(tok) }),
      balance ? null : request('GET', '/api/personal/balance', { headers: H(tok) }),
    ]);
    if (rt2) {
      if (isAuthFail(rt2)) return { err: expiredHint(key) };
      reward = reward || pick(rt2.text, /"reward_amount"\s*:\s*"?([0-9.]+)"?/, '');
      day = day || pick(rt2.text, /"checkin_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/, '');
    }
    if (rb2) {
      if (isAuthFail(rb2)) return { err: expiredHint(key) };
      balance = pick(rb2.text, /"balance"\s*:\s*"?([0-9.]+)"?/, '');
    }
  }

  const st = STATE[key] || {};
  let streak = Number(st.streak) || 0;
  if (day) {
    if (day !== st.last_checkin) {
      streak = st.last_checkin && st.last_checkin === prevDay(day) ? streak + 1 : 1;
    }
    streak = streak || 1;
    STATE[key] = Object.assign({}, st, { last_checkin: day, streak });
    saveState();
  }

  const done = /已签到|已经签到|明天再来/.test(msg);
  return {
    status: done ? '已签到' : '签到成功',
    body: [
      `【用户名：${st.username || '未知'}】`,
      `【获得：${reward || '未知'} 元】`,
      `【余额：${balance || '未知'} 元】`,
      `【连续签到：${streak || '未知'} 天】`,
    ],
  };
}

async function main() {
  if (!TOKENS.length) {
    await notify('闲鱼接口 API 【配置缺失】',
      '请配置环境变量 XIANYU_REFRESH_TOKEN：登录 api.xianyushop.shop 后控制台执行 '
      + 'localStorage.getItem("api_refresh_token")，多账号用 & 分隔。');
    return;
  }
  if (!ensureWritable()) {
    await notify('闲鱼接口 API 【无法保存 token，已中止】',
      `存档路径不可写：${STATE_FILE}\n`
      + '续期会把 refresh_token 轮换掉，新值存不下来等于把这条永久烧掉。\n'
      + '解决：修正该目录权限，或设置 QL_DIR 指向青龙数据目录。');
    return;
  }

  const results = [];
  for (let i = 0; i < TOKENS.length; i++) {
    try { results.push(await runOne(i, TOKENS[i])); }
    catch (e) { results.push({ err: '执行异常：' + e.message }); }
  }

  const many = results.length > 1;
  const hasErr = results.some(r => r.err);
  const okStatus = [...new Set(results.filter(r => !r.err).map(r => r.status))];
  const head = many
    ? `闲鱼接口 API 【${!hasErr && okStatus.length === 1 ? okStatus[0] : '签到结果'}】`
    : `闲鱼接口 API 【${hasErr ? '执行失败' : results[0].status}】`;
  const blocks = results.map((r, i) => {
    const who = many ? `[账号${i + 1}]\n` : '';
    return who + (r.err ? r.err : r.body.join('\n'));
  });
  await notify(head, blocks.join('\n\n'));
}

main()
  .catch(e => console.error('脚本异常：' + ((e && e.message) || e)))
  .finally(() => AGENT.destroy());
