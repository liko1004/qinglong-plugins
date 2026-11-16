# qinglong-plugins

青龙面板自用签到脚本，共 7 个，默认每天 08:00 执行一次（cron 写在文件头部，青龙订阅时会自动建任务）。

## 脚本一览

| 脚本 | 站点 | 干什么 | 环境变量 |
|---|---|---|---|
| `99code.js` | gpt.api456.me | 领每日公益额度 | `CODE99_COOKIE` |
| `pttime.js` | www.pttime.org | PT 每日签到 | `PTTIME_COOKIE` |
| `u2-dmhy.js` | u2.dmhy.org | PT 每日签到 | `U2_COOKIE` |
| `azusa.js` | azusa.wiki | 无签到，只保号 | `AZUSA_COOKIE` |
| `xianyushop.js` | api.xianyushop.shop | 每日签到领余额 | `XIANYU_REFRESH_TOKEN` |
| `hyperdown_checkin.py` | hyperdown.net | 每日签到领流量 | `HYPERDOWN_COOKIE` |
| `doubao_checkin.py` | www.doubao.com | 每日签到领 200 活动额度 | `DOUBAO_COOKIE` |

## Cookie 怎么拿（控制台一行命令）

绝大多数站点的套路都一样：浏览器登录后按 `F12`，切到 **Console（控制台）**，粘一行命令回车，把输出整段复制到青龙环境变量里。

> **例外是豆包**：它的 `sessionid` 标了 HttpOnly，控制台读不到，必须走 Network 面板，见下方 [doubao_checkin.py](#doubao_checkinpy--doubao_cookie) 一节。

通用命令，绝大多数站点直接可用：

```js
document.cookie
```

输出形如 `c_secure_uid=xxxx; c_secure_pass=yyyy; c_secure_ssl=zzzz`，**整行照抄**就是环境变量的值。

嫌手动选文字麻烦，就在前面套一层 `copy()`，回车后已经进剪贴板了：

```js
copy(document.cookie)
```

PT 站（pttime / u2 / azusa）如果页面上还混着统计、广告之类的 cookie，只取登录用的那几个更干净：

```js
document.cookie.split('; ').filter(s => /^c_secure_/.test(s)).join('; ')
```

> 有两点要注意：
> - 标了 `HttpOnly` 的 Cookie 控制台读不到，这时输出会偏少甚至为空，改用 **Network → 刷新 → 任意请求 → Request Headers → `Cookie:`** 整行复制，那一段一定完整。**豆包就是这种情况**——控制台复制出来的那份看着字段很多（`x-tt-multi-sids`、`flow_cur_user_sec_id` 一应俱全），但缺了真正管鉴权的 `sessionid`，接口一律回 `710012001 登录已过期`；
> - 命令要在站点自己的域名页面下执行（比如 `www.pttime.org`），在别的标签页跑拿到的会是别的站点的 cookie。

## 各脚本的凭证格式

### 99code.js —— `CODE99_COOKIE`

这个站除了 Cookie 还要一个 UID，两者必须属于同一账号，所以拼在同一个变量里，格式：

```
UID=<用户ID>,session=<会话值>
```

控制台粘这一行，直接把拼好的完整值放进剪贴板：

```js
copy('UID=' + JSON.parse(localStorage.user).id + ',session=' + (document.cookie.match(/session=([^;]*)/) || ['', ''])[1])
```

如果输出里 `session=` 后面是空的，说明它是 HttpOnly，去 **Application → Cookies → session** 复制值，手工拼成 `UID=xxx,session=yyy`。

> 站点强制校验 `New-Api-User` 请求头，UID 和 Cookie 对不上会直接 401。

### pttime.js —— `PTTIME_COOKIE`

控制台执行 `copy(document.cookie)`，粘到环境变量里即可，值形如：

```
c_secure_uid=xxxx; c_secure_pass=yyyy; c_secure_ssl=zzzz; c_secure_login=...
```

站点按 Cookie 认人，**不需要**填 UID（`PTTIME_UID` 是历史兼容项，不用管）。

### u2-dmhy.js —— `U2_COOKIE`

同 pttime，在 `u2.dmhy.org` 页面执行 `copy(document.cookie)`，整条粘进去：

```
c_secure_uid=xxxx; c_secure_pass=yyyy; ...
```

### azusa.js —— `AZUSA_COOKIE`

同 pttime，在 `azusa.wiki` 页面执行 `copy(document.cookie)`，整条粘进去。该站没有签到按钮，脚本只访问一次首页确认登录态、取一下魔力值，用于保号。

### xianyushop.js —— `XIANYU_REFRESH_TOKEN`

不是 Cookie，是登录后存在 localStorage 里的刷新令牌。登录 `api.xianyushop.shop` 后控制台执行：

```js
copy(localStorage.getItem('api_refresh_token'))
```

令牌已进剪贴板，**复制完立刻关掉这个标签页**——页面自动续期会把这条值轮换掉，标签页留着就会失效。

令牌是轮换式的，脚本会把续期后的新值写进 `/ql/data/token/xianyushop-token.json`，下次优先读存档。存档目录不可写时脚本会直接中止（否则等于把令牌烧掉）。

### hyperdown_checkin.py —— `HYPERDOWN_COOKIE`

这个站没有可复用的 Cookie，变量里填**账号密码**：

```
账号,密码
```

依赖 `pynacl`，青龙「依赖管理」里新建一个 Python3 依赖填 `pynacl`，或在容器内 `pip3 install pynacl`。

### doubao_checkin.py —— `DOUBAO_COOKIE`

**别用 `copy(document.cookie)`**。豆包的 `sessionid` 是 HttpOnly，控制台那份里根本没有它，粘进去必然回 `710012001`。正确姿势：

1. `www.doubao.com` 登录后按 `F12`，切到 **Network**；
2. 刷新页面，点任意一条发往 `www.doubao.com` 的请求；
3. 右侧 **Request Headers → `Cookie:`**，把冒号后面**整行**复制进环境变量。

值形如：

```
hook_slardar_session_id=xxxx; passport_csrf_token=xxxx; s_v_web_id=xxxx; sessionid=xxxx; sid_tt=xxxx; ttwid=xxxx; ...
```

`sessionid` 是关键，缺它一切免谈——而且它不在控制台里，只能从请求头来。

如果更习惯 **Application → Storage → Cookies** 那个表格，也可以：只取 `sessionid` 那一行的 **Value**，自己拼成 `sessionid=xxx` 填进去。注意别把整行连属性一起抄（`ttwid=xxx; Max-Age=...; Domain=.doubao.com; Path=/; HttpOnly` 这种），那串是表格的显示格式，不是 Cookie 请求头。脚本会把 `Max-Age` / `Expires` / `Domain` / `Path` / `HttpOnly` / `Secure` / `SameSite` 这些属性剔掉，但**值本身选错了它救不了你**。

几个坑先说在前面：

- **`ttwid` 不是登录态**。它只是设备指纹，单独带它打接口照样回 `710012001`。名字里带 `sid` 的 `x-tt-multi-sids`、`hook_slardar_session_id` 也都不管用，能鉴权的只有 `sessionid`；
- **只支持个人账号**。豆包工作版和飞书企业号没有「天天领额度」这个活动，签到接口会回 `710010702`，脚本会如实报「该账号没有可领的签到活动」；
- **飞书登录的号要留意**：Cookie 里带 `feishu_dpop_keypair` 或 `LARK_SUITE_DPOP`，说明这个豆包号是用飞书登的，多半是企业号，回 `710010702`，这种号不必再折腾；
- **只认国内 IP**，青龙装在国内机器上直接可用，港外/海外节点多半会失败；
- 活动页本身有「仅支持豆包电脑版参与」的前端环境检测，但**接口不校验**，纯 Cookie 就能打；
- Cookie 通常几周～几个月失效，失效时接口回 `710012001`，脚本报「登录已失效」，重抓一次即可。

可选变量：

| 变量 | 用途 |
|---|---|
| `DOUBAO_UA` | 覆盖默认 User-Agent，默认是 Windows 版 Chrome |
| `DOUBAO_EXTRA_HEADERS` | JSON 对象，往请求里追加头，如 `{"x-tt-passport-csrf-token":"xxx"}` |

签到请求本身服务端幂等（已签过返回 `idempotent: true`，不重复发放），所以一天多跑几次不会有副作用。**每次运行只打一个请求**——活动额度累计要另打 `/alice/ug/campaign/v3/detail`，那个接口的参数口径不稳（`campaign_group_code` / `campaign_code` 都回 `invalid param`，GET 直接 404），不值得为一行数字多打一次。

## 多账号怎么配

统一规则：**同一个环境变量里用 `&` 分隔**，脚本按顺序逐个执行（串行，不并发）。

```
PTTIME_COOKIE   = cookie1&cookie2
U2_COOKIE       = cookie1&cookie2
AZUSA_COOKIE    = cookie1&cookie2
CODE99_COOKIE   = UID=1,session=aaa&UID=2,session=bbb
XIANYU_REFRESH_TOKEN = token1&token2
HYPERDOWN_COOKIE     = a@x.com,pw1&b@x.com,pw2
DOUBAO_COOKIE        = cookie1&cookie2
```

注意两点：

- Cookie 内部用 `;` 分隔各项，本身不含 `&`，所以用 `&` 拆分是安全的；
- 多账号时通知正文会按 `[账号1]`、`[账号2]` 分块，方便看哪个号出了问题。

## 通知

推送走青龙面板「系统设置 → 通知配置」，先在面板里启用并测试一个渠道。标题形如 `PTtime 【签到成功】`，正文每行一个 `【键：值】`：

```
【用户名：demo】
【魔力值：1234.5】
【获得：5 魔力值】
【连续签到：3 天】
```

站点页面上没有的字段会整行省略，不写「未知」。豆包的样张（已签到时没有【获得】行）：

```
豆包 【签到成功】

【获得：200 活动额度】
【连续签到：3 天】
```

## 安全

Cookie、token、账号密码只放在青龙的环境变量里，不要写进脚本，也不要提交到仓库（`.gitignore` 已屏蔽 `cookie*`、`*.token`、`.env` 等文件）。
