# Surge Modules

适用于 Surge iOS 和 Surge Mac 的模块合集。包含节点出口查询、连通性诊断、YouTube 地区检测、剧集追更和域名规则收集。

## 模块一览

| 模块 | 用途 | 安装链接 |
| --- | --- | --- |
| [IPTest 节点质量查询](#iptest-节点质量查询) | 查询当前出口的 IP、ASN、归属和风险评分 | [安装模块][iptest] |
| [节点 TCPing 连通性测试](#节点-tcping-连通性测试) | 对照本机连通性、代理出口和远端 TCP 探测结果 | [安装模块][tcping] |
| [YouTube 送中检测](#youtube-送中检测) | 逐个检测本地节点，并更新 `Proxy` 组的候选节点 | [iOS][youtube-ios] · [Mac][youtube-mac] |
| [追更提醒与 TMDB](#追更提醒与-tmdb) | 查看平台更新进度和 TMDB 排期，按需接收提醒 | [安装模块][episode-watch] |
| [域名规则收集](#域名规则收集) | 从实际请求积累域名规则，导出后用于分流 | [安装模块][rule-storage] |
| [Muse US 自动化](#muse-us-自动化) | iOS 使用 Muse 时，让走到收集规则的请求使用美国策略 | [iOS][muse-us-ios] |

## 安装与使用

1. 复制表中的安装链接，在 Surge 的「模块」页面选择从 URL 安装。
2. 启用模块，在模块设置中填写下文列出的参数。策略名和策略组名需与当前配置一致。
3. 面板类模块安装后，iOS 在「策略」页刷新对应面板，Mac 在菜单栏的 Surge 图标下打开「面板」。域名规则收集通过 `[Rule]` 触发。 [Surge 模块说明][surge-modules] · [信息面板说明][surge-panels]

## IPTest 节点质量查询

刷新「节点质量查询」面板，查看指定策略当前使用的出口 IP、位置、ASN、网络类型及各数据源的风险评分。要查看策略组里的另一个节点，先切换该组所选节点，再刷新面板。

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `POLICY` | `Proxy` | 查询出口时使用的策略或策略组 |
| `MASK_IP` | `true` | 在面板中遮盖部分 IP |

## 节点 TCPing 连通性测试

适合排查节点连不上时卡在哪一段。刷新面板后，可以对照本机直连、经指定策略访问外网，以及 Globalping 探针连接节点入口的结果。

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `POLICY` | `Proxy` | 用于测试出口的策略或策略组 |
| `NODE_HOST` | `example.com` | 节点服务器域名或 IP，需替换为实际值 |
| `NODE_PORT` | `443` | 节点服务器端口，按实际值填写 |
| `NODE_TYPE` | `TCP` | 节点协议，用于显示 UDP 测试提示 |
| `API_POLICY` | `Proxy` | Surge 请求 Globalping API 时使用的策略 |
| `MASK_IP` | `true` | 在面板中遮盖部分 IP |

`POLICY` 决定从哪个出口访问测试服务，`NODE_HOST` 和 `NODE_PORT` 决定远端探针测试哪个服务器。Globalping 探针在此模块中使用 TCP，Hysteria 2、WireGuard 等 UDP 节点的可用性需要另行判断。

## YouTube 送中检测

支持 **Surge iOS 6.0+** 和 **Surge Mac 6.11.0+**。iOS 信息面板需要有效的功能订阅。当前配置里需要有一个可编辑的 `Proxy` Smart 策略组，并通过 `include-all-proxies=1` 或 `include-all-proxies=true` 纳入本地节点。 [iOS 模块][youtube-ios] · [Mac 模块][youtube-mac]

手动刷新「YouTube 送中检测」面板后，脚本会逐个通过节点访问 YouTube Premium，复测判为中国大陆地区的节点，并更新 `Proxy` 的 `policy-regex-filter`。已排除的节点确认恢复后会重新加入。超时或地区无法判定时，沿用该节点原来的候选状态。若本轮没有确认正常的节点，保留当前候选。

过滤结果适用于所有使用 `Proxy` 的流量。如果该组已有自定义筛选，面板会提示检查配置，并保留原有筛选。

## 追更提醒与 TMDB

「追更提醒」沿用许舟的脚本，查询平台更新进度并发送通知。「TMDB 排期」显示最近已播集和下一集预计播出日期。各平台的会员及免费更新时间以平台为准。由旧模块迁移时，先停用旧模块，再把原剧单填入新版，原追更记录可以继续使用。 [许舟原版脚本][episode-upstream]

| 参数 | 填法 |
| --- | --- |
| `WATCHLIST` | 原版剧单，多部用分号分隔，最多 5 部。只用 TMDB 时可留空 |
| `TMDB_TOKEN` | 在 Surge 模块设置中填写自己的 **API Read Access Token**。留空时仍可使用原版追更 |
| `TMDB_WATCHLIST` | 默认沿用 `WATCHLIST`，也可填写独立剧单，最多 5 部。例如 `Breaking Bad（2008）`、`tmdb:1396 S02` 或 `tmdb:1396 S02E03` |
| `TMDB_NOTIFY` | 默认为 `false`，设为 `true` 后每 30 分钟检查 TMDB 播出提醒 |

开启 TMDB 提醒后，首次检查只建立记录，只有日期的排期按北京时间当日结束计算。两个面板同时跟踪同一部剧时，可能各发送一次提醒。iOS 用户需要在系统设置中允许 Surge 通知。 [TMDB API 设置][tmdb-api]

[![TMDB][tmdb-logo]][tmdb]

This product uses the TMDB API but is not endorsed or certified by TMDB.

## 域名规则收集

模块提供 `Save-China-Rule` 和 `Save-Final-Rule` 两条规则脚本。请求执行到脚本时才会计入。默认同一主机名累计 **10 次**才生成规则，两次计数至少相隔 **30 秒**。

| 脚本 | 导出读取的缓存键 | 匹配行为 |
| --- | --- | --- |
| `Save-China-Rule` | `Rule-Storage-china` | 按配置报告命中，由调用它的规则指定策略 |
| `Save-Final-Rule` | `Rule-Storage-global` | 记录请求后继续匹配后续规则 |

### 从 NobyDa 原版迁移

安装并启用本仓库的模块，移除原配置 `[Script]` 中这两个同名声明。现有的 `[Rule]`、生成的规则集和导出快捷指令可以继续使用。如果旧声明自定义了 `key`、`quantity` 或 `interval`，也可以采用手动迁移，只替换两行中的 `script-path`，保留原参数和快捷指令的缓存键。 [新版脚本 URL][rule-storage-script] · [NobyDa 原文][rule-storage-upstream]

### 首次配置

1. 安装并启用模块。将下列两条收集规则放在已有业务规则之后、普通的 `GEOIP,CN` 和 `FINAL` 之前。示例假设大陆 IP 直连，其他请求走已有的 `Proxy` 策略。已有 `FINAL` 时，合并到现有配置并保留唯一的 `FINAL`。
2. 在用来导出的设备上开启 Surge 的 HTTP API 与 iCloud 同步，导入 NobyDa 的快捷指令，按提示填入 HTTP API 端口和密码。 [导出快捷指令][rule-storage-shortcut] · [原文导出说明][rule-storage-export]
3. 让流量积累一段时间，再运行快捷指令。原版默认在 iCloud 的 Surge 文件夹下生成 `Rule/Domestic_Set.txt` 和 `Rule/Foregn_Set.txt`。在 Surge 的「最近请求」里可以看到请求最终命中的规则和策略。

```ini
[Rule]
# 保留原有业务规则和手写例外
AND,((GEOIP,CN),(SCRIPT,Save-China-Rule)),DIRECT
SCRIPT,Save-Final-Rule,Proxy
FINAL,Proxy,dns-failed
```

这个例子用 `GEOIP,CN` 检查目标 IP。已被前面的规则处理的请求会跳过收集。若规则匹配时 DNS 查询失败，示例里的 `dns-failed` 会直接使用 `FINAL` 策略，这次请求也会跳过收集。 [Surge 匹配顺序][surge-rules] · [FINAL 选项][surge-final]

文件生成后，先检查内容，再把下面两条放到收集规则前、手写例外后。域名如果已出现在两份名单里，排在前面的规则集优先。

```ini
RULE-SET,Rule/Domestic_Set.txt,DIRECT
RULE-SET,Rule/Foregn_Set.txt,Proxy
```

### 精确收集与 App 域名

- 模块的 `EXACT` 默认为 `false`。设为 `true` 后，每条新规则使用 `DOMAIN,完整主机名`。开关只影响新规则。如果要从零开始收集一份精确名单，可以使用独立的 `region`。
- **Mac** 可以用 `PROCESS-NAME` 选择本机 App，再调用一条独立的收集脚本。 [Surge 进程规则][surge-process]
- **iOS** 可以一次只测试一个 App 的一个功能，对照操作前后的「最近请求」确认可重复出现的主机名。后台请求也会出现在记录中。 [Surge 请求记录][surge-capture]

<details>
<summary>Mac 示例 · 收集 Telegram 的请求域名</summary>

分别加入已有的 `[Script]` 和 `[Rule]`。将这条规则放在可能提前匹配该 App 的规则之前。省略 `matched` 时，脚本只记录，后续规则继续决定分流策略。

```ini
[Script]
Save-Telegram-Rule = type=rule, script-path=https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/rule-storage/Rule-Storage.js, argument=region=telegram&exact=1

[Rule]
AND,((PROCESS-NAME,Telegram),(SCRIPT,Save-Telegram-Rule)),DIRECT
```

在导出快捷指令中增加一项，读取 `Rule-Storage-telegram`，并保存到单独的文件，例如 `Rule/Telegram.list`。

</details>

本模块改编自 [NobyDa 的 Rule-Storage.js][rule-storage-source]，按 [GPL-3.0](modules/rule-storage/LICENSE) 发布。

## Muse US 自动化

1. 在 Surge iOS 启用 [Muse US 自动化模块][muse-us-ios]。如果此前在配置里手动添加了 `Muse-US-On`、`Muse-US-Off`、`Muse-US-Active`、`Save-Muse-iOS` 的脚本声明，可以删除这四条本地声明，由模块提供。
2. 在当前配置的 `[Rule]` 中加入下方规则，放在已有的明确分流规则之后、通用 `GEOIP` 和 `FINAL` 之前。把 `US` 换成已有的美国策略组名。
3. 在 iPhone 的「快捷指令 → 自动化」中分别设置 Muse 的「已打开」和「已关闭」。在「在后台运行定时或事件脚本」动作中，打开时选 `Muse-US-On`，关闭时选 `Muse-US-Off`。两条都选立即运行，参数留空。

```ini
AND,((SCRIPT,Muse-US-Active),(SCRIPT,Save-Muse-iOS)),US
```

切离 Muse 时关闭分流窗口，窗口也会在开启 15 分钟后自动到期。在这段时间里，走到这条规则的请求会使用 `US`，其中包括可能碰巧经过同一规则的后台请求。自动记录保存在 `Rule-Storage-muse-ios`，可用原导出快捷指令读取并单独保存为候选域名列表。

[iptest]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/iptest/iptest.sgmodule
[tcping]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/nodetcpcheck/nodetcpcheck.sgmodule
[youtube-ios]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/youtube-proxy-check/youtube-proxy-check-ios.sgmodule
[youtube-mac]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/youtube-proxy-check/youtube-proxy-check.sgmodule
[episode-watch]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/episode-watch/episode-watch.sgmodule
[rule-storage]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/rule-storage/rule-storage.sgmodule
[muse-us-ios]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/muse-us-ios/muse-us-ios.sgmodule
[rule-storage-script]: https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/rule-storage/Rule-Storage.js
[rule-storage-upstream]: https://nobyda.github.io/2024/02/24/Surge_Rule_Storage/
[rule-storage-export]: https://nobyda.github.io/2024/02/24/Surge_Rule_Storage/#配置快捷指令
[rule-storage-shortcut]: https://www.icloud.com/shortcuts/39c9a8720c9a49288ac1a2bf433da098
[rule-storage-source]: https://github.com/NobyDa/Script/blob/10d1426d9d60edb37e24451b28811b163efc8e43/Rule-Storage/Rule-Storage.js
[episode-upstream]: https://github.com/zhiaon/Modules/blob/2023610554c60db4e2293039220788c176eac3db/surge_scripts/episode-watch.js
[tmdb-api]: https://www.themoviedb.org/settings/api
[tmdb-logo]: https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg
[tmdb]: https://www.themoviedb.org/
[surge-modules]: https://manual.nssurge.com/profile/module.html
[surge-panels]: https://manual.nssurge.com/tools/panel.html
[surge-rules]: https://manual.nssurge.com/rules/overview.html
[surge-final]: https://manual.nssurge.com/rules/final.html
[surge-process]: https://manual.nssurge.com/rules/process.html
[surge-capture]: https://manual.nssurge.com/tools/http-capture.html
