#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
豆包「天天领额度」每日签到 —— 青龙面板

cron: 0 8 * * *

流程：launch 定位活动组 → detail 读每日签到任务 → 已签则跳过，未签则领取

变量：DOUBAO_COOKIE —— www.doubao.com 的完整 Cookie，多账号用 & 分隔
      DOUBAO_UA / DOUBAO_EXTRA_HEADERS —— 可选，覆盖 UA、追加请求头
      DOUBAO_QUERY_ONLY=1 —— 只查状态，不发领取请求
依赖：无
"""

import builtins
import json
import os
import urllib.error
import urllib.request

SITE = "豆包"
BASE = "https://www.doubao.com"
LAUNCH = "/alice/user/launch"
DETAIL = "/alice/ug/campaign/v3/detail/"
CHECKIN = "/alice/ug/campaign/landing/checkin"
GROUP = "pc_incentive_task_mvp_v3"

# 活动接口要求的一串客户端标识，少一个就回 invalid param（实测）
QS = ("aid=1044603&real_aid=1044603&device_platform=web&version_code=20800"
      "&samantha_web=1&web_platform=desktop&doubao_device_platform=desktop"
      "&client_platform=pc_client&pkg_type=release_version&runtime=web"
      "&runtime_version=3.42.2&pc_version=2.33.5&doubao_pc_version=2.33.5"
      "&use-olympus-account=1&language=zh&region=CN&sys_region=CN")

UA = (os.environ.get("DOUBAO_UA", "").strip()
      or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
ACCOUNTS = [s.strip() for s in
            os.environ.get("DOUBAO_COOKIE", "").split("&") if s.strip()]
QUERY_ONLY = os.environ.get("DOUBAO_QUERY_ONLY", "").strip() == "1"

# 710012001 登录失效；710010702 领取接口要官方客户端现算的风控字段
CODE_AUTH = 710012001
CODE_SDK = 710010702

AUTH_MSG = ("登录已失效，请重抓 Cookie：sessionid 是 HttpOnly，document.cookie 读不到，"
            "要从 F12 → Network → 请求头 Cookie 整行复制")
SDK_HINT = ["【原因：领取接口要官方客户端现算的风控字段，纯 Cookie 算不出来】",
            "【做法：在豆包电脑版点一次「立即签到」，本脚本负责回读状态】"]

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


def post(path, cookie, body, timeout=20):
    data = json.dumps(body, separators=(",", ":")).encode()
    hdr = {"Accept": "application/json, text/plain, */*",
           "Content-Type": "application/json",
           "Agw-Js-Conv": "str",
           "Origin": BASE,
           "Referer": BASE + "/chat/",
           "User-Agent": UA,
           "Cookie": cookie}
    hdr.update(EXTRA)

    req = urllib.request.Request(BASE + path + "?" + QS, data=data,
                                 headers=hdr, method="POST")
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


def msg_of(js):
    if isinstance(js, dict):
        return js.get("msg") or js.get("message") or str(js)[:160]
    return str(js)[:160]


def launch(cookie):
    """定位当前账号的活动组，拿不到就退回默认组。"""
    st, js = post(LAUNCH, cookie, {})
    if st == -1:
        raise RuntimeError(js)
    if st in (401, 403) or (isinstance(js, dict) and js.get("code") == CODE_AUTH):
        raise RuntimeError(AUTH_MSG)
    if not isinstance(js, dict) or js.get("code") != 0:
        raise RuntimeError("读取活动入口失败（HTTP %s）：%s" % (st, msg_of(js)))
    info = ((js.get("data") or {}).get("ug_campaign_info") or {})
    return info.get("campaign_group_code") or GROUP


def read(cookie, group):
    """读活动详情，返回 (签到任务列表, 累计额度)。"""
    st, js = post(DETAIL, cookie, {"campaign_group_code": group})
    if st == -1:
        raise RuntimeError(js)
    if st in (401, 403):
        raise RuntimeError("登录已失效，请重新抓取 Cookie（HTTP %s）" % st)
    if not isinstance(js, dict):
        raise RuntimeError("活动详情返回非 JSON（HTTP %s）：%s" % (st, str(js)[:160]))
    if js.get("code") == CODE_AUTH:
        raise RuntimeError(AUTH_MSG)
    if js.get("code") != 0:
        raise RuntimeError("读取活动详情失败 code=%s %s" % (js.get("code"), msg_of(js)))

    data = js.get("data") if isinstance(js.get("data"), dict) else {}
    tasks = [t for t in (data.get("tasks") or [])
             if isinstance(t, dict) and (isinstance(t.get("daily_checkin"), dict)
                                        or t.get("task_kind") == "daily_signin")]
    total = (data.get("progress") or {}).get("total_amount")
    return tasks, total


def body_lines(daily, total, got=None):
    lines = []
    if got:
        lines.append("【获得：%s 活动额度】" % got)
    if daily.get("continuous_days") not in (None, ""):
        lines.append("【连续签到：%s 天】" % daily["continuous_days"])
    if total not in (None, ""):
        lines.append("【额度累计：%s】" % total)
    return lines or ["【结果：今日签到已完成】"]


def claim(cookie, group, daily, total):
    st, js = post(CHECKIN, cookie, {"scene": group})
    if st == -1:
        raise RuntimeError(js)
    if st in (401, 403):
        raise RuntimeError("登录已失效，请重新抓取 Cookie（HTTP %s）" % st)
    if not isinstance(js, dict):
        raise RuntimeError("领取接口返回非 JSON（HTTP %s）：%s" % (st, str(js)[:160]))

    code = js.get("code")
    if code == CODE_AUTH:
        raise RuntimeError(AUTH_MSG)
    if code == CODE_SDK:
        return {"status": "需手动签到", "body": body_lines(daily, total) + SDK_HINT}
    if code != 0:
        raise RuntimeError("领取失败 code=%s %s" % (code, msg_of(js)))

    data = js.get("data") if isinstance(js.get("data"), dict) else {}
    if data.get("checked_in") is False:
        raise RuntimeError("领取未生效：服务端没把今日置为已签，稍后重跑一次")
    if data.get("continuous_days") not in (None, ""):
        daily = dict(daily, continuous_days=data["continuous_days"])
    try:
        total = read(cookie, group)[1] or total   # 回读一次拿最新累计额度
    except RuntimeError:
        pass
    return {"status": "已签到" if data.get("idempotent") else "签到成功",
            "body": body_lines(daily, total,
                               None if data.get("idempotent") else data.get("reward_amount"))}


def run_one(raw):
    cookie = clean_cookie(raw)
    try:
        group = launch(cookie)
        tasks, total = read(cookie, group)
        if not tasks:
            raise RuntimeError("该账号没有「每日签到」任务：活动未投放，或工作版 / 企业号不参与")
        if len(tasks) > 1:
            raise RuntimeError("活动结构异常：找到 %d 个签到任务，已放弃领取" % len(tasks))

        daily = tasks[0].get("daily_checkin") or {}
        if daily.get("checked_in_today") is True:
            return {"status": "已签到", "body": body_lines(daily, total)}
        if QUERY_ONLY:
            return {"status": "待签到", "body": body_lines(daily, total)}
        return claim(cookie, group, daily, total)
    except RuntimeError as e:
        return {"err": str(e)}


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
