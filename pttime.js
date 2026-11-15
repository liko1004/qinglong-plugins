/**
 * PtTime —— www.pttime.org PT 签到（青龙面板）
 *
 * cron: 0 8 * * *
 *
 * 变量：PTTIME_COOKIE —— 站点 Cookie，多账号用 & 分隔
 *       PTTIME_UID    —— 可选，填了会在签到链接后加 ?id=（站点按 Cookie 认人，一般不用填）
 *
 * 状态判定：签到页文案优先（「已经签到」→ 已签到），再用签到记录日期反验本次是否真的生效。
 */

'use strict';

const https = require('https');
const zlib = require('zlib');

const SITE_NAME = 'PTtime';
const BASE = 'https://www.pttime.org';
const COOKIES = splitEnv(process.env.PTTIME_COOKIE || '');
const UIDS = splitEnv(process.env.PTTIME_UID || '');
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

async function runOne(cookie, uid) {
  const H = {
    'accept-language': 'zh-CN,zh;q=0.9',
    'referer': BASE + '/torrents.php',
    'cookie': cookie,
  };

  const r1 = await request('GET', '/attendance.php' + (uid ? '?id=' + encodeURIComponent(uid) : ''), { headers: H });
  if (r1.status !== 200) return { err: `签到请求失败（status=${r1.status}）` };

  const r2 = await request('GET', '/attendance.php?type=list', {
    headers: Object.assign({}, H, { 'referer': BASE + '/index.php' }),
  });
  const qdTime = pick(r2.text, /签到记录.*?时间：(\d+-\d+-\d+ \d+:\d+:\d+)/, '未知');
  const qdMoli = pick(r2.text, /签到记录.*?时间：.*?获得魔力值.*?(\d+)/, '未知');
  const qdDays = pick(r2.text, /签到记录.*?时间：.*?连续天数.*?(\d+)/, '未知');
  const moli = pick(r2.text, /使用&说明<\/a>\]\s*[：:]\s*([\d.]+)/, '未知');
  const name = pick(r2.text, /class='.+_Name'><b>(.+?)<\/b>/, '未知');

  const body = [
    `【用户名：${name}】`,
    `【魔力值：${moli}】`,
    `【获得：${qdMoli} 魔力值】`,
    `【连续签到：${qdDays} 天】`,
  ];

  const today = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
  const said = /已经签到|已签到|今日已签到/.test(r1.text);
  if (said) return { status: '已签到', body };
  if (qdTime !== '未知' && qdTime.slice(0, 10) === today) return { status: '签到成功', body };

  body.push(`【注意：签到未生效，最近记录仍是 ${qdTime}】`
    + (uid
      ? '（Cookie 可能已过期，或该账号本次签到被拒）'
      : '（站点可能要求 id 参数，补填 PTTIME_UID 即可：个人页面 userdetails.php?id= 后面的数字）'));
  return { status: '签到失败', body };
}

async function main() {
  if (!COOKIES.length) {
    await notify(SITE_NAME + ' 【配置缺失】', '请先在青龙环境变量配置 PTTIME_COOKIE。');
    return;
  }

  const n = Math.max(COOKIES.length, UIDS.length);
  const pairs = Array.from({ length: n }, (_, i) => [COOKIES[i] || COOKIES[0] || '', UIDS[i] || UIDS[0] || '']);

  const results = [];
  for (let i = 0; i < pairs.length; i++) {
    try { results.push(await runOne(pairs[i][0], pairs[i][1])); }
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
