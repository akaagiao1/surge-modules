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
