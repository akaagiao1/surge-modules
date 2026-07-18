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
