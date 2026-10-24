# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [0.2.0] — 2026-10-24

公开作用域改为 `@aisketch/*`，新增 `draw` 与 `figure` 两类原生卡片。

### 新增

- **`show_card` → `kind: "draw"` 手绘卡**
  - 五种元素：`path` / `shape` / `text` / `tape` / `pixels`；七种笔型、四种纸张、13 色白名单与限额。
  - SVG 迷你路径语法（M/L/H/V/C/S/Q/T/A/Z，含相对命令、隐式重复、S/T 反射、弧旗标无分隔）由自写解析器归一化。
  - 确定性手绘引擎：贝塞尔/弧线拉平、变宽度轮廓、钢笔/书法笔/荧光笔/铅笔颗粒、像素画按颜色分组。
  - `path.fill` + `path.fillOpacity`、`shape.fillOpacity`，支持有机闭合路径与半透明水洗。
  - 离屏预览 + 机器自检（越界/留白/平衡/色相族/文字压图），预览与浏览器渲染共用同一引擎。
  - `draft: true` 私有草稿：模型可自查，但卡片节点不发布；用户只看到最终稿。
- **`show_card` → `kind: "figure"` 教学示意图**
  - `incline_force`：斜面角度、质量、摩擦系数、可选 g/分量/数值；G/N/f 由构造与公式决定。
  - `connected_bodies`：桌面块 + 定滑轮 + 悬挂块；T/N/G/f 锚在对应块面，T 不伪造数值。
  - `orbital_diagram`：H–Zn 电子排布与轨道框；按洪特规则填充，模型不写电子数或坐标。
  - `atom_shell`：H–Ca 中性原子壳层；Z 与壳层电子数从内置参考表推导。
- **卡片放大**：`table` / `flowchart` / `draw` / `figure` 统一标题行与放大弹窗；函数图展开后 1000×600。
- **兼容性声明**：`sketch-bundle` 增加 `engines.dsh`，当前范围 `>=0.1.7-rc.2 <0.2.0`。
- **社区发布资产**：13 张能力截图、介绍文章、GitHub topics/keywords。

### 变更

- 包作用域统一为公开的 `@aisketch/*`；移除各包 `private`，补 keywords、author、repository、homepage、bugs。
- 版本统一为 `0.2.0`。
- 安装文档改为公开仓库的 clone + link 流程；补充插件面板与 `engines.dsh` 说明。

### 验证

- **470 例**单元/集成测试：cards-core 159 / sketch-core 58 / client-ui-cards 146 / client-ui-sketch 37 / cards-tool 42 / sketch-tool 28。
- 六个包 `tsc --noEmit` 全清；两个 `lib/client.js` 构建通过。
- 真机验收：函数图 canvas 像素回读；流程图读到起止胶囊、菱形判断、是/否分支与汇合箭头；Zn 轨道图核对 15 个轨道 / 30 个电子与洪特规则。
- 回归钉：wiring 闸门、turnTail 发布键必须等于 Definition 的 kind、draw 的 draft/final 过滤。

### 已知限制

- 有些卡片会被 DSH 的「回合过程折叠」藏起来，需要把工作步骤展示切到「完全展开（verbose）」才能看到；这是 dsh 的显示逻辑，不是插件未渲染。
- 「完全展开」档下同一张卡出现两次（过程行 + 产出物行），未去重。
- 「轨迹」页看不到卡片（view target 是 `chat`，按设计只显示原始调用）。
- `figure` 只有四个模板；`orbital_diagram` 支持 H–Zn，`atom_shell` 支持 H–Ca。
- Host 半与 client 半的改动都需要重启应用才生效（无 HMR）；运行中不要重建 client 产物。

## [0.1.0] — 2026-10-01

首个公开版本。两条通道 + 零 base 改动。

### 新增

- **`show_card` 通用卡片通道**（`cards-core` / `cards-tool` / `client-ui-cards`）
  - `kind: "table"`：1..12 列、≤500 行，表头吸顶、数字右对齐、`null` 显示 `--`。
  - `kind: "flowchart"`：1..40 节点、≤80 连线，`shape` ∈ terminal/process/decision；分层布局、分支标签、回边 gutter、共享端点扇开。
  - 未知 kind 走 raw 兜底（卡片永不静默消失）。
  - 信封校验与限额在 Host；每条连线必须指向已声明节点。
- **`sketch_function` 表达式绘图**（`sketch-core` / `sketch-tool` / `client-ui-sketch`）
  - 六模式：plain / compare / tangent / riemann / taylor / data。
  - 参数滑块 + 播放；交互期间 y 窗口冻结（参数盒角点并集）。
  - 追踪读数：悬停 / 点按钉住 / 键盘步进；交互态纯本地，回放回到原值。
  - 自写 Pratt 表达式解析器，**无 `eval` / `new Function`**；高阶导数用 Fornberg 单模板。
- **产出物可见性契约**：卡片与图同时挂 `tool.call.toolview` 与 `conversation.chat.turnTail`，四档工作步骤展示模式都常驻可见（后者豁免折叠策略）。
- **装配包 `sketch-bundle`**：`dsh.bundle.patch` 声明，装一个包挂 4 行（2 Host + 2 Client）。

### 验证

- 264 例单元/集成测试（cards-core 61 / cards-tool 15 / client-ui-cards 68 / sketch-core 58 / sketch-tool 28 / client-ui-sketch 34），六个包 `tsc --noEmit` 全清。
- 真机验收：运行中的桌面端逐档肉眼验证；函数图 canvas 像素回读（曲线 4449 px、坐标轴 979 px）；流程图截图读到胶囊起点、菱形判断、两条分支与汇合箭头。
- 回归钉：wiring 闸门（少注册任一张脸即红，做过对照实验）、turnTail 发布键必须等于 Definition 的 kind。

### 已知限制

- 「完全展开」档下卡片出现两次（过程行 + 产出物行），未去重。
- 「轨迹」页看不到卡片（view target 是 `chat`，按设计只显示原始调用）。
- Host 半与 client 半的改动都需要重启应用才生效（无 HMR）。
