# 给 DSH 加一条「模型出结构、客户端作图」的卡片通道：dsh-aisketch

> 开源仓库：[QinLuza/dsh-aisketch](https://github.com/QinLuza/dsh-aisketch) · MIT · 当前适配 dsh `0.1.7-rc.2`

**一句话**：`dsh-aisketch` 给 DSH（DeepSeek Harness）加了两条通道——`show_card`（模型给 `kind + payload`，会话里出原生卡片：表格、SVG 流程图、手绘插画、教学示意图）与 `sketch_function`（模型给一条表达式，出可交互函数图像）。**零 base 改动**。

**English TL;DR** — Two extension points for DSH: `show_card` (table / SVG flowchart / hand-drawn draw / semantic teaching figures) and `sketch_function` (six interactive plot modes). Structure comes from the model; geometry comes from a deterministic engine. MIT, zero base changes.

![手绘插画卡](https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/draw-illustration.png)

---

## 为什么再做一条卡片通道

模型想把一件事讲清楚时，手上常常只有文字。于是它写 Markdown 表格、画 ASCII 图，或者更糟——生成一段 HTML/SVG 让你渲染。前两者难看且难读，后者是在**执行模型生成的代码**，而且不可回放。

DSH 本体已经有「每个内置工具自己的卡片模型」（read / grep / diff / terminal / web / image …），也有 `present` 把已有文件声明为交付物；但它没有一条让模型**自选内容**的通用卡片通道，也没有通用绘图/图表/流程图工具。

`dsh-aisketch` 补的正是这一格：**模型只交结构，几何由确定性引擎算**。没有 `eval`、没有 `new Function`、不把生成的 HTML/SVG 字符串塞进 DOM；同一份 payload 必然画出同一张图，所以回放旧会话，卡片一模一样。

---

## 现在能画什么

### 函数图：一条表达式，六种模式

`plain` 单曲线 / `compare` 多曲线 / `tangent` 切线 / `riemann` 黎曼和 / `taylor` 泰勒展开 / `data` 数据图表。模型侧开销实测 **4–45 token**；卡片带参数滑块、追踪读数，展开后 1000×600 画布。

<p>
  <img src="https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/sketch-single.png" width="49%" alt="单曲线" />
  <img src="https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/sketch-riemann.png" width="49%" alt="黎曼和" />
</p>

### 表格与流程图

`table`：1..12 列、≤500 行，表头吸顶、数字右对齐、空值显示 `--`。

`flowchart`：1..40 节点、≤80 连线，胶囊起止、菱形判断、分支标签、回边绕右侧 gutter、共享端点自动扇开；卡片可放大。

![流程图](https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/flowchart-parity.png)

### 手绘插画

`draw`：模型只写中心线、形状、文字、胶带或像素网格；钢笔出锋、书法笔角度、荧光笔半透明、铅笔颗粒、手绘抖动全部由引擎算。支持 `draft: true` 私有草稿与最终稿，用户只看到成品。

### 教学示意图

`figure` 不塞进 `draw`：插画怕平庸，示意图怕错误。模型只填模板与语义参数，坐标、角度、锚点、标签全部由渲染器构造。

- `incline_force`：斜面、物块、G/N/f，力的大小由 m/g/θ/μ 计算；
- `connected_bodies`：桌面块 + 定滑轮 + 悬挂块，T/N/G/f 锚在对应块面；
- `orbital_diagram`：H–Zn 电子排布与轨道框，按洪特规则填充；
- `atom_shell`：H–Ca 原子壳层，Z 与电子层数从参考表推导。

<p>
  <img src="https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/figure-incline-30.png" width="49%" alt="斜面受力" />
  <img src="https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/figure-connected-table-pulley.png" width="49%" alt="桌面连接体" />
</p>
<p>
  <img src="https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/figure-orbital-zn.png" width="49%" alt="Zn 电子排布" />
  <img src="https://raw.githubusercontent.com/QinLuza/dsh-aisketch/master/docs/assets/screenshots/figure-atom-na.png" width="49%" alt="Na 原子壳层" />
</p>

---

## 三条设计边界

1. **不执行模型生成的代码。** `draw` 的路径串只经过自己的迷你语法解析器；未知命令、空路径、指数记法一律拒绝，错误带 `element N:` 前缀，模型可以自己改。
2. **几何是载荷的纯函数。** 流程图分层/换行/箭头锚点、函数图采样/视窗/数值微分积分，全在确定性引擎里算；因此回放等价，也能在 vitest 里断言。
3. **校验在 Host 就做。** 节点数、连线数、id 唯一、`shape` 取值、每条连线必须指向已声明节点；报错让模型自己改，而不是画出来少一条边。

---

## 安装（link 安装，已验证）

```bash
git clone https://github.com/QinLuza/dsh-aisketch.git
cd dsh-aisketch
pnpm install
pnpm build:client
dsh plugin --profile <profile> add link:<repo>/packages/sketch-bundle
dsh --profile <profile> --dump-config
```

桌面端的 `desktop` profile 被 Electron 应用独占，CLI 装不进去；请用应用自己的**插件面板**，安装来源填 `packages/sketch-bundle` 的绝对路径。

`packages/sketch-bundle/package.json` 已声明 `engines.dsh`：`>=0.1.7-rc.2 <0.2.0`。改完 Host 半必须重启应用；改完 client 半必须重新构建 `lib/client.js` 再重启——**不要在运行中重建 client 产物**。

---

## 质量与证据

- **470 例**单元/集成测试，六个包 `tsc --noEmit` 全清；两个 client 产物构建通过。
- 真机验收不是「没报错」：函数图 canvas 像素回读；流程图截图读到胶囊起点、菱形判断、是/否分支与汇合箭头；电子排布图逐项核对轨道数、电子数与洪特规则。
- 回归钉：wiring 闸门（少注册一张脸即红）、`turnTail` 发布键必须等于 Definition 的 kind、draw 的 draft/final 过滤。

---

## 一个必须说清楚的限制：有些卡片会被 dsh「吞掉」

这不是插件坏了，而是 **dsh 的显示逻辑**：

工具调用按定义属于「回合过程」，而 dsh 的工作步骤展示有「简洁 / 标准 / 详细 / 完全展开」四档；在部分档位或版本下，过程区的卡片会被折叠或藏起来，**只有把信息展示切到「完全展开（verbose）」或展开对应回合才能看到**。本插件已经把产出物同时挂到 `turnTail`，但宿主版本与展示设置仍可能影响最终可见性。排查时请先切「完全展开」，再看卡片是否在。

顺带的取舍：「完全展开」档下同一张卡会出现两次（过程行 + 产出物行），目前未去重；「轨迹」页按设计只显示原始调用，看不到卡片。

其他限制：`figure` 只有四个模板，不是通用约束求解器；`orbital_diagram` 只支持 H–Zn，`atom_shell` 只支持 H–Ca；`draw` 是确定性矢量手绘，不是像素级绘画模型。

---

## 发布与社区

DSH 官方目前**没有插件提交入口或审核流程**。官方 `CONTRIBUTING.md` 的建议是把 GitHub 项目关联到 **`dsh-plugin`** topic；插件市场不内置索引源，第三方索引通过「自定义索引」添加。社区事实渠道：

- GitHub Topics：`dsh-plugin`、`deepseek-harness`、`dsh`；
- `awesome-dsh-plugin` 精选列表（PR 收录）；
- `deepseek-ai/deepseek-harness` 的 GitHub Discussions（反馈与展示）。

本仓库 topics / keywords：`dsh-plugin, deepseek-harness, dsh, visualization, diagram, table, flowchart, draw, figure, function-plot, svg, agent-tools`。

---

## 欢迎

- 注册你自己的卡片 `kind`：一个载荷解析器 + 一个渲染器 + 一组测试；
- 用出问题请带 `show_card` 的原始参数开 issue；
- 如果它帮你省掉了一坨 ASCII 图，欢迎 star。

**仓库**：[github.com/QinLuza/dsh-aisketch](https://github.com/QinLuza/dsh-aisketch) · **License**：MIT

---

## 短版（适合发一条动态）

> 给 DSH 写了个插件 **dsh-aisketch**（MIT）：模型不用再写 ASCII 表或生成 HTML——它交 `kind + payload`，客户端出原生卡片：表格、流程图、手绘插画、教学示意图；另一个工具 `sketch_function` 让它一条表达式画出可交互函数图（切线/黎曼和/泰勒展开都行）。
> 零 base 改动，全靠官方槽位；470 例测试。
> 一个必须说清楚的限制：有些卡片会被 dsh 的「回合过程折叠」吞掉，切到「完全展开」才能看到——这是 dsh 的显示逻辑，不是插件坏了。
> 仓库：[QinLuza/dsh-aisketch](https://github.com/QinLuza/dsh-aisketch)
