# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

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
