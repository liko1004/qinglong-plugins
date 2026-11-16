# qinglong-plugins

青龙面板自用签到脚本，共 6 个，默认每天早上 7:50~7:55 各错开一分钟执行（写在文件头部，青龙订阅时会自动建任务）。

## 脚本一览

| 脚本 | 站点 | 干什么 | 环境变量 |
|---|---|---|---|
| `99code.js` | gpt.api456.me | 领每日公益额度 | `CODE99_COOKIE` |
| `pttime.js` | www.pttime.org | PT 每日签到 | `PTTIME_COOKIE` |
| `u2-dmhy.js` | u2.dmhy.org | PT 每日签到 | `U2_COOKIE` |
| `azusa.js` | azusa.wiki | 无签到，只保号 | `AZUSA_COOKIE` |
| `xianyushop.js` | api.xianyushop.shop | 每日签到领余额 | `XIANYU_REFRESH_TOKEN` |
| `hyperdown_checkin.py` | hyperdown.net | 每日签到领流量 | `HYPERDOWN_COOKIE` |

## 定时与任务名

每个脚本头部声明了 `cron` 和任务名，青龙订阅同步时按声明自动建任务：

| 脚本 | 任务名 | 定时 |
|---|---|---|
| `pttime.js` | PTtime签到 | 每天 07:50 |
| `u2-dmhy.js` | U2动漫花园签到 | 每天 07:51 |
| `azusa.js` | azusa保号 | 每天 07:52 |
| `99code.js` | 99code签到 | 每天 07:53 |
| `xianyushop.js` | 闲鱼接口API签到 | 每天 07:54 |
| `hyperdown_checkin.py` | Hyperdown签到 | 每天 07:55 |

任务名写在注释里的 `任务名：new Env('xxx')` 行（仅供青龙解析，不会执行）。没有这行声明，旧版面板会抓脚本里第一个含 `name:` 的行当任务名——`xianyushop.js` 就曾因为 `username:` 里藏着 `name:` 被命名成一段代码。

两点注意：

- cron 按容器时区解释，容器若是 UTC 会差 8 小时，需设置 `TZ=Asia/Shanghai`；
- 青龙不会更新已建任务的名称和周期，改了声明后要**删掉旧任务再同步订阅**（或手动改名/改 cron）才生效。

## Cookie 怎么拿（控制台一行命令）

绝大多数站点的套路都一样：浏览器登录后按 `F12`，切到 **Console（控制台）**，粘一行命令回车，把输出整段复制到青龙环境变量里。

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
> - 标了 `HttpOnly` 的 Cookie 控制台读不到，这时输出会偏少甚至为空，改用 **Network → 刷新 → 任意请求 → Request Headers → `Cookie:`** 整行复制，那一段一定完整；
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

## 多账号怎么配

统一规则：**同一个环境变量里用 `&` 分隔**，脚本按顺序逐个执行（串行，不并发）。

```
PTTIME_COOKIE   = cookie1&cookie2
U2_COOKIE       = cookie1&cookie2
AZUSA_COOKIE    = cookie1&cookie2
CODE99_COOKIE   = UID=1,session=aaa&UID=2,session=bbb
XIANYU_REFRESH_TOKEN = token1&token2
HYPERDOWN_COOKIE     = a@x.com,pw1&b@x.com,pw2
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

站点页面上没有的字段会整行省略，不写「未知」。

## 安全

Cookie、token、账号密码只放在青龙的环境变量里，不要写进脚本，也不要提交到仓库（`.gitignore` 已屏蔽 `cookie*`、`*.token`、`.env` 等文件）。
