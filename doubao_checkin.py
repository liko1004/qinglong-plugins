#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
豆包「天天领额度」每日签到 —— 青龙面板

cron: 0 8 * * *

变量：DOUBAO_COOKIE —— www.doubao.com 的完整 Cookie，多账号用 & 分隔
      DOUBAO_UA / DOUBAO_EXTRA_HEADERS —— 可选，覆盖 UA、追加请求头
依赖：无
"""

import builtins
import json
import os
import urllib.error
import urllib.request

SITE = "豆包"
BASE = "https://www.doubao.com"
CHECKIN = BASE + "/alice/ug/campaign/landing/checkin"
SCENE = "pc_incentive_task_mvp_v3"
UA = (os.environ.get("DOUBAO_UA", "").strip()
      or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
ACCOUNTS = [s.strip() for s in
            os.environ.get("DOUBAO_COOKIE", "").split("&") if s.strip()]

# 710012001 登录失效；710010702 Cookie 有效但这个号没有该活动（工作版 / 飞书企业号）
CODE_AUTH = 710012001
CODE_NO_ACTIVITY = 710010702

try:
    EXTRA = json.loads(os.environ.get("DOUBAO_EXTRA_HEADERS") or "{}")
    EXTRA = {str(k): str(v) for k, v in EXTRA.items()} if isinstance(EXTRA, dict) else {}
except ValueError:
    print("[警告] DOUBAO_EXTRA_HEADERS 不是合法 JSON，已忽略")
    EXTRA = {}

# DevTools 的 Cookies 表格直接复制会带 Max-Age / Domain / Path 这类属性，剔掉再发
COOKIE_ATTRS = {"max-age", "expires", "domain", "path", "httponly", "secure",
                "samesite", "priority", "partitioned", "size"}


def clean_cookie(raw):
    return "; ".join(s.strip() for s in raw.split(";")
                     if s.strip()
                     and s.split("=", 1)[0].strip().lower() not in COOKIE_ATTRS)


def post(url, cookie, body, timeout=20):
    data = json.dumps(body, separators=(",", ":")).encode()
    hdr = {"Accept": "application/json, text/plain, */*",
           "Content-Type": "application/json",
           "Origin": BASE,
           "Referer": BASE + "/pc/agent-explore",
           "User-Agent": UA,
           "Cookie": cookie}
    hdr.update(EXTRA)

    req = urllib.request.Request(url, data=data, headers=hdr, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            st, raw = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "网络错误：%s" % e

    try:
        return st, json.loads(raw)
    except ValueError:
        return st, raw


def body_lines(data, already=False):
    lines = []
    if not already and data.get("reward_amount"):
        lines.append("【获得：%s 活动额度】" % data["reward_amount"])
    if data.get("continuous_days") not in (None, ""):
        lines.append("【连续签到：%s 天】" % data["continuous_days"])
    return lines or ["【结果：今日签到已完成】"]


def notify(title, content):
    content = "" if content is None else str(content)
    print("\n===== %s =====\n%s" % (title, content))

    # QLAPI 由青龙注入在 builtins，不在模块 globals
    qlapi = getattr(builtins, "QLAPI", None) or globals().get("QLAPI")
    if qlapi is None:
        print("[通知] 未检测到青龙 QLAPI，已跳过推送")
        return
    for fn in ("systemNotify", "notify"):
        f = getattr(qlapi, fn, None)
        if not callable(f):
            continue
        try:
            res = f({"title": title, "content": content})
        except Exception as e:
            print("[通知] 推送异常：%s" % e)
            continue
        if not isinstance(res, dict) or res.get("code", 200) == 200:
            return
        print("[通知] 推送失败(code=%s)：%s —— 请到青龙「系统设置 → 通知配置」启用并测试一个渠道"
              % (res.get("code"), res.get("message") or "未知原因"))
        return


def run_one(raw):
    cookie = clean_cookie(raw)
    st, js = post(CHECKIN, cookie, {"scene": SCENE})
    if st == -1:
        return {"err": js}
    if st in (401, 403):
        return {"err": "登录已失效，请重新抓取 Cookie（HTTP %s）" % st}
    if not isinstance(js, dict):
        return {"err": "签到接口返回非 JSON（HTTP %s）：%s" % (st, str(js)[:200])}

    code = js.get("code")
    msg = js.get("msg") or js.get("message") or ""
    if code == CODE_AUTH:
        return {"err": "登录已失效%s，请重抓 Cookie：sessionid 是 HttpOnly，"
                       "document.cookie 读不到，要从 F12 → Network → 请求头 Cookie 整行复制"
                       % ("（%s）" % msg if msg else "")}
    if code == CODE_NO_ACTIVITY:
        return {"err": "该账号没有可领的签到活动：仅豆包个人账号参与，工作版 / 飞书企业号不支持"}
    if code != 0:
        return {"err": "签到失败 code=%s %s" % (code, msg or str(js)[:160])}

    data = js.get("data") if isinstance(js.get("data"), dict) else {}
    # 领取接口服务端幂等：已签过返回 idempotent=true，不会重复发放
    already = bool(data.get("idempotent"))
    # 额度累计要另打 /v3/detail，那个接口参数口径不稳（invalid param / GET 404），
    # 不值得为一行数字多一次请求
    return {"status": "已签到" if already else "签到成功",
            "body": body_lines(data, already)}


def main():
    if not ACCOUNTS:
        notify(SITE + " 【配置缺失】",
               "请配置环境变量 DOUBAO_COOKIE，内容为 www.doubao.com 的完整 Cookie，"
               "多账号用 & 分隔。")
        return

    results = []
    for raw in ACCOUNTS:
        try:
            results.append(run_one(raw))
        except Exception as e:
            results.append({"err": "执行异常：%s" % e})

    many = len(results) > 1
    errs = any(r.get("err") for r in results)
    statuses = {r["status"] for r in results if not r.get("err")}
    if many:
        head = SITE + " 【%s】" % (
            statuses.pop() if not errs and len(statuses) == 1 else "签到结果")
    else:
        head = SITE + " 【%s】" % ("执行失败" if errs else results[0]["status"])

    blocks = []
    for i, r in enumerate(results):
        text = r["err"] if r.get("err") else "\n".join(r["body"])
        blocks.append("[账号%d]\n%s" % (i + 1, text) if many else text)
    notify(head, "\n\n".join(blocks))


if __name__ == "__main__":
    main()
