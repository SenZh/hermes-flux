# 模型厂商图标资产 (Vendor Icon Assets)

本目录是 [`@lobehub/icons-static-svg`](https://github.com/lobehub/lobe-icons) 的原样拷贝，用于按厂商自动渲染品牌图标。

| 项 | 值 |
|---|---|
| 上游 | `@lobehub/icons-static-svg` 1.102.0 |
| 许可 | MIT（见同目录 `LICENSE`） |
| 文件数 | 994 个 SVG（全量保留，含 `-text` 字标与 `-brand` 底图变体） |
| 生成器 | `scripts/gen-vendor-icons.mjs` |

## 变体命名

- `<slug>.svg` — mono 版，`fill="currentColor"`，随文字色与皮肤变色；
- `<slug>-color.svg` — 品牌原色版；
- `<slug>-text.svg` / `<slug>-text-cn.svg` — 图形 + 品牌文字的横向组合标；
- `<slug>-brand.svg` / `<slug>-brand-color.svg` — 带背景容器的版本。

列表行只用前两种，其余保留备用。

## 为什么需要双轨（暗/浅两侧判定）

彩色版是画死的十六进制，两个方向会各自翻车：OpenAI / Anthropic / xAI 的标识本身是黑色，
深色底上不可见；OpenRouter 的荧光绿 `#C8FF00` 对白底仅 1.18:1，浅色底上同样不可见。
因此清单对每个彩色资产同时记录 `colorDarkSafe` 与 `colorLightSafe`，
渲染层据此在「永远彩色 / 深色出 mono / 浅色出 mono / 永远 mono」之间选择。

判定采用「达标色值数 >= 总数一半」：多色 logo 的轮廓由多段色块共同支撑
（Google 四色里只有黄色对白底不足），单色低对比（OpenRouter / NVIDIA）则必然被判不安全。

当前分布（共 357 个基础族）：

| 组合 | 数量 | 渲染形态 |
|---|---|---|
| 两侧都安全 | 135 | 永远彩色 |
| 仅深色安全 | 69 | 深色出彩色、浅色出 mono |
| 仅浅色安全 | 32 | 浅色出彩色、深色出 mono |
| 两侧都不安全 | 0 | 永远 mono |
| 只有 mono 变体 | 121 | 永远 mono |

## 更新方式

```bash
node scripts/gen-vendor-icons.mjs
```

脚本会下载对应版本 tarball、清空并覆盖本目录、重新生成 `../vendorIconAssets.ts`。
升级版本时修改脚本顶部的 `PACKAGE_VERSION`。
