#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hyperdown (hyperdown.net) 每日签到 —— 青龙面板
任务名：new Env('Hyperdown签到')

cron: 55 7 * * *

变量：HYPERDOWN_COOKIE —— 站点登录账号与密码，格式 账号,密码，多账号用 & 分隔
依赖：pip3 install pynacl
"""

import base64
import builtins
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

try:
    from nacl.bindings import (
        crypto_aead_xchacha20poly1305_ietf_encrypt,
        crypto_scalarmult,
        crypto_scalarmult_base,
    )
except ImportError:
    print("缺少依赖 pynacl，请先执行: pip3 install pynacl")
    sys.exit(1)

SITE_NAME = "Hyperdown"
BASE = "https://hyperdown.net"
API = BASE + "/api/v1"
SERVER_PUB = bytes.fromhex(
    "dd85f63f107a32ce3def4835fe56c27865a1557fedad19adbd72ff81ea2e1025")
INFO_PREFIX = "hyperdown-secure-api:v1"
UA = "Hyperdown/1.1.6"
NAME_KEYS = ("nickname", "username", "name")
TRAFFIC_KEYS = ("traffic_bytes", "available_traffic", "available_traffic_bytes",
                "traffic", "bytes", "used_bytes", "quota_bytes")
DAYS_KEYS = ("total_days_check_in", "check_in_days", "checkin_days",
             "streak_days", "consecutive_days")
ACCOUNTS = [s.strip() for s in
            os.environ.get("HYPERDOWN_COOKIE", "").split("&") if s.strip()]


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def hkdf(secret, salt, info, n=32):
    prk = hmac.new(salt, secret, hashlib.sha256).digest()
    okm, t, i = b"", b"", 1
    while len(okm) < n:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t
        i += 1
    return okm[:n]


def seal(body, path, token, method="POST"):
    method = method.upper()
    npath = path.split("?", 1)[0].strip()
    ts = int(time.time())
    eph = os.urandom(32)
    pub = crypto_scalarmult_base(eph).hex()
    shared = crypto_scalarmult(eph, SERVER_PUB)
    rid = os.urandom(16).hex()
    nonce = os.urandom(24)
    salt = hashlib.sha256((rid + ":" + str(ts)).encode()).digest()
    key = hkdf(shared, salt, ("%s:%s:%s" % (INFO_PREFIX, method, npath)).encode())
    ad = ("%s\n%s\n%s\n%d" % (method, npath, rid, ts)).encode()
    ct = b64u(crypto_aead_xchacha20poly1305_ietf_encrypt(body, ad, nonce, key))
    nonce_s = b64u(nonce)
    msg = b"\x00".join(x.encode() for x in
                       ["v1", method, npath, rid, str(ts), nonce_s, pub, ct, token])
    return json.dumps({"v": "v1", "request_id": rid, "ts": ts, "nonce": nonce_s,
                       "pub": pub, "ciphertext": ct,
                       "sign": b64u(hmac.new(key, msg, hashlib.sha256).digest())},
                      separators=(",", ":"))


def request(method, path, token=None, body=None, sealed=False, timeout=20):
    hdr = {"Accept": "application/json", "User-Agent": UA}
    data = None
    if body is not None:
        raw = json.dumps(body, separators=(",", ":")).encode()
        if sealed:
            data = seal(raw, "/api/v1" + path, token or "", method).encode()
            hdr["X-Hyperdown-Secure"] = "v1"
        else:
            data = raw
        hdr["Content-Type"] = "application/json"
    if token:
        hdr["Authorization"] = "Bearer " + token

    req = urllib.request.Request(API + path, data=data, headers=hdr, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, str(e)

    if raw.strip().startswith("{"):
        try:
            return status, json.loads(raw)
        except ValueError:
            pass
    return status, raw


def human(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return str(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return "%s %s" % (("%.2f" % n).rstrip("0").rstrip("."), unit)
        n /= 1024.0


def _user_obj(js):
    if not isinstance(js, dict):
        return None
    data = js.get("data")
    if isinstance(data, dict):
        return data["user"] if isinstance(data.get("user"), dict) else data
    return js


def _first(d, keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k):
            return d[k]
    return None


def profile(token, hint=None, email=""):
    user = _user_obj(hint)
    name, traffic = _first(user, NAME_KEYS), _first(user, TRAFFIC_KEYS)
    days = _first(user, DAYS_KEYS)
    for path in ("/me", "/me/snapshot"):
        if name and traffic is not None and days is not None:
            break
        st, js = request("GET", path, token=token, timeout=15)
        if st == 200:
            user = _user_obj(js)
            name = name or _first(user, NAME_KEYS)
            if traffic is None:
                traffic = _first(user, TRAFFIC_KEYS)
            if days is None:
                days = _first(user, DAYS_KEYS)
    return str(name or email or "未知"), traffic, days


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


def body_lines(username, traffic, got=None, streak=None):
    return [
        "【用户名：%s】" % username,
        "【可用流量：%s】" % (human(traffic) if traffic is not None else "未知"),
        "【获得：%s】" % (human(got) if got else "未知"),
        "【连续签到：%s 天】" % (streak if streak not in (None, "") else "未知"),
    ]


def login(email, password):
    st, js = request("POST", "/auth/login", body={"email": email, "password": password})
    if st in (401, 403):
        return None, "登录失败：%s 账号或密码错误" % email
    if st != 200 or not isinstance(js, dict):
        return None, "登录失败 HTTP %s %s" % (st, str(js)[:120])
    data = js.get("data") or {}
    token = (js.get("token") or js.get("access_token")
             or data.get("access_token")
             or (data.get("tokens") or {}).get("access_token"))
    if not token:
        return None, "登录返回中没有 token：%s" % str(js)[:200]
    return token, None


def _reward(js):
    for src in (js, _user_obj(js)):
        if not isinstance(src, dict):
            continue
        for k in ("reward_bytes", "reward_traffic", "today_reward_bytes"):
            if src.get(k):
                return src[k]
    return None


def run_one(raw):
    email, _, password = raw.partition(",")
    email, password = email.strip(), password.strip()
    if not (email and password):
        return {"err": "账号格式错误，应为 账号,密码"}

    token, err = login(email, password)
    if err:
        return {"err": err}

    st, js = request("POST", "/me/checkins", token=token, body={}, sealed=True)
    obj = js if isinstance(js, dict) else {}
    code = ((obj.get("error") or {}).get("code", "")
            if isinstance(obj.get("error"), dict) else "")

    if st == 401 or code in ("unauthorized", "invalid_credentials", "token_expired"):
        return {"err": "登录失效：请检查 %s 的账号或密码" % email}

    if code in ("already_checked_in", "already_checked"):
        username, traffic, days = profile(token, obj, email)
        return {"status": "已签到",
                "body": body_lines(username, traffic, None,
                                   obj.get("streak_days") or days)}

    if st == 200 and isinstance(js, dict) and not code:
        username, traffic, days = profile(token, js, email)
        got = _reward(js)
        return {"status": "签到成功",
                "body": body_lines(username, traffic, got,
                                   js.get("streak_days") or days)}

    detail = json.dumps(js, ensure_ascii=False)[:300] if isinstance(js, dict) else str(js)
    return {"err": "签到失败 HTTP %s %s" % (st, detail)}


def main():
    if not ACCOUNTS:
        notify(SITE_NAME + " 【配置缺失】",
               "请配置环境变量 HYPERDOWN_COOKIE，格式 账号,密码，多账号用 & 分隔。")
        return

    results = []
    for raw in ACCOUNTS:
        try:
            results.append(run_one(raw))
        except Exception as e:
            results.append({"err": "执行异常：%s" % e})

    many = len(results) > 1
    has_err = any(r.get("err") for r in results)
    statuses = {r["status"] for r in results if not r.get("err")}
    if many:
        head = SITE_NAME + " 【%s】" % (
            statuses.pop() if not has_err and len(statuses) == 1 else "签到结果")
    else:
        head = SITE_NAME + " 【%s】" % ("执行失败" if has_err else results[0]["status"])

    blocks = []
    for i, r in enumerate(results):
        who = "[账号%d]\n" % (i + 1) if many else ""
        blocks.append(who + (r["err"] if r.get("err") else "\n".join(r["body"])))
    notify(head, "\n\n".join(blocks))


if __name__ == "__main__":
    main()
