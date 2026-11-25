# Surge Modules

个人 Surge 模块合集与适配脚本。

## 模块

### IPTest 节点质量查询

检测指定 Surge 策略或策略组当前出口的 IP、ASN、位置、网络类型及多来源风险评分。

安装链接：

```text
https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/iptest/iptest.sgmodule
```

在 Surge 中安装模块后设置：

- `POLICY`：需要检测的策略或策略组名称，默认 `Proxy`
- `MASK_IP`：是否隐藏部分 IP，默认 `true`

> Surge 无法复刻 Loon 的“长按任意节点检测”入口。本版本通过策略选择页的信息面板刷新，检测指定策略组当前选中的出口。

### 节点 TCPing 连通性测试

通过 Globalping 的大陆和海外探针检测指定节点入口的 TCP 连通性，辅助判断是否疑似被 GFW 定向阻断。

安装链接：

```text
https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/nodetcpcheck/nodetcpcheck.sgmodule
```

安装后必须设置：

- `POLICY`：用于检测节点出口的策略或策略组
- `NODE_HOST`：节点服务器域名或 IP
- `NODE_PORT`：节点服务器端口
- `NODE_TYPE`：节点协议类型，仅用于 UDP 协议提示
- `API_POLICY`：访问 Globalping API 的策略
- `MASK_IP`：是否隐藏部分 IP

> Surge 不会向面板脚本提供所选节点的底层服务器地址和端口，因此 `NODE_HOST` 和 `NODE_PORT` 需要手动填写。

### YouTube 送中检测

点击「YouTube 送中检测」面板的刷新按钮即可检测 `Proxy` 的所有本地节点。脚本通过各节点访问 YouTube Premium，复测确认后把被判为中国大陆地区的节点从 `Proxy` 候选中剔除。已剔除的节点在确认恢复正常后会加回。遇到超时或地区无法判定时，保留节点原有的候选状态。

安装和使用

- Mac 6.11.0 或以上版本。在菜单栏的 Surge 图标中展开「面板」，刷新「YouTube 送中检测」。[Mac 安装链接](https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/youtube-proxy-check/youtube-proxy-check.sgmodule)
- Surge iOS 6.0 或以上版本。在模块页面选择「从 URL 安装模块」，启用后到策略选择页刷新「YouTube 送中检测」。面板需要有效的功能订阅。[iOS 安装链接](https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/youtube-proxy-check/youtube-proxy-check-ios.sgmodule)

需要可编辑的 `Proxy` Smart 策略组，且该组通过 `include-all-proxies=1` 或 `include-all-proxies=true` 纳入本地节点。剔除结果写入 `Proxy` 的筛选项，适用于所有走该组的流量。如果 `Proxy` 已有自定义筛选，面板会提示检查设置。

### 追更提醒 + TMDB

模块包含两个面板。「追更提醒」沿用许舟的原版脚本查询平台进度并发送通知。「TMDB 排期」显示最近已播集和下一集的播出日期。国内平台的会员及免费更新进度以平台为准。若已安装旧模块，请停用旧模块，再把原剧单填入新版。已有的原版追更记录可以继续使用。[安装模块](https://raw.githubusercontent.com/akaagiao1/surge-modules/main/modules/episode-watch/episode-watch.sgmodule) · [原版脚本](https://github.com/zhiaon/Modules/blob/2023610554c60db4e2293039220788c176eac3db/surge_scripts/episode-watch.js)

- `WATCHLIST` 填原版剧单，多部用分号分开，最多 5 部。
- `TMDB_TOKEN` 在 Surge 的模块设置里填写自己的 **API Read Access Token**。留空时仍可使用原版追更。[TMDB API 设置](https://www.themoviedb.org/settings/api)
- `TMDB_WATCHLIST` 默认沿用 `WATCHLIST`，也可填写独立剧单。例如 `Breaking Bad（2008）`、`tmdb:1396 S02` 或 `tmdb:1396 S02E03`。只用 TMDB 时，将 `WATCHLIST` 留空。
- `TMDB_NOTIFY` 默认 `false`。设为 `true` 可开启额外的「TMDB 播出提醒」，它按北京时间当天结束判断播出日期。首次检查静默建立记录。原版和 TMDB 都追同一部时，可能在不同时间各提醒一次。请在 iOS 设置中允许 Surge 通知。

#### 数据来源

[![TMDB](https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg)](https://www.themoviedb.org/)

This product uses the TMDB API but is not endorsed or certified by TMDB.
