# dsh-aisketch

给 [DSH](https://github.com/deepseek-ai)（DeepSeek Harness）加两条「**模型只给结构、客户端负责作图**」的通道：

| 工具 | 模型给什么 | 用户看到什么 |
|---|---|---|
| `show_card` | `kind` + 结构化 `payload`（数据表 / 流程图 / 将来任何 kind） | 会话里的原生卡片（表格、SVG 流程图） |
| `sketch_function` | 一条函数表达式 + 参数范围（实测 4–45 token） | 可交互函数图像（六模式 + 参数滑块 + 追踪读数） |

**零 base 改动**：全部走官方扩展点（tool 注册 + `tool.call.toolview` / `conversation.chat.node` / `conversation.chat.turnTail` 槽位），没有一行改动 `@deepseek-ai/dsh-*`。

MIT 许可。

---

## 一、它补的是哪一块（和 DSH 本体的关系）

先把"是不是重造轮子"说清楚，因为这条决定了这个插件值不值得存在：

| | DSH 本体已有 | 本插件补的 |
|---|---|---|
| 卡片怎么来 | **每个内置工具自己的卡片模型**：read / grep / diff / terminal / web / image / ask_user_question …，渲染器写死在客户端，一一对应 | **一条通用通道**：模型自选内容，`kind` 决定用哪个渲染器；加一种卡片 = 注册一个组件，不动聊天节点契约 |
| 交付物 | `present` 工具：把**已有文件**声明为最终交付物（只记路径 + 说明，**不搬文件内容**） | 把**结构化内容本身**交付到会话里（表格 / 流程图 / 函数图），不需要先落盘成文件 |
| 图表/流程图 | 官方工具目录 `docs/tool-catalog.zh.md`（101 个工具条目）里**没有**任何绘图、图表、流程图工具 | `flowchart` 与六种函数图模式 |
| 可见性 | 工具调用属于「回合过程」，会被工作步骤展示模式折叠 | 卡片同时挂 `turnTail` 产出物槽位，四档模式都常驻可见 |

实据：在 base 仓里 `grep -r "show_card\|sketch_function"` = **0 命中**；本体那条路是"给已知工具写死卡片"，我们这条是"给未知内容开通道"。

### 两条不可让渡的边界

1. **产出物必须可见。** 工具调用按定义属于「回合过程」，而过程会被折叠：`ui-chat` 的 `TURN_PROCESS_INDEPENDENT_KINDS` 只豁免 8 种回合骨架 kind，**没有任何工具节点**。所以卡片不能只有 `toolview` 一张脸，必须同时在 `conversation.chat.turnTail` 上有一张脸 —— 那是 base 留给产出物的槽位（官方 `ui-deliverables` 的改动文件卡就走这条）。
2. **零代码执行。** 没有 `eval`、没有 `new Function`、不把生成的 HTML/SVG 字符串塞进 DOM。模型只交结构化 spec，**几何在确定性引擎里算**：流程图的分层、换行、箭头锚点、扇开偏移，函数图的采样、自适应视窗、数值微分/积分，全是载荷的纯函数 —— 因此**回放等价**（同一 spec 必然同一张图）且可在 vitest 里断言，不需要 DOM。

---

## 二、能力

### `show_card` —— 通用卡片通道

| kind | 载荷 | 渲染 |
|---|---|---|
| `table` | `{ columns: string[], rows: (string\|number\|boolean\|null)[][] }`（1..12 列，≤500 行） | 原生表格：表头吸顶、数字右对齐等宽、`null` 显示为 `--`、超宽横向滚动 |
| `flowchart` | `{ nodes: [{ id, label, shape }], edges: [{ from, to, label }] }`（1..40 节点，≤80 连线，`shape` ∈ `terminal`/`process`/`decision`） | SVG 流程图：胶囊起点/终点、菱形判断、分支标签、回边走右侧 gutter |
| 其它任何 kind | 任意 JSON | **raw 兜底**：标题 + kind 芯片 + 原始负载。卡片永不静默消失 —— 未知 kind 至少让你看见它到了 |

校验在 **Host 就做**（`cards-core`）：列数/行数/节点数/连线数上限、id 唯一、`shape` 取值、**每条连线必须指向已声明节点**。不做"画出来少一条边"这种事 —— 报错让模型自己改。

### `sketch_function` —— 表达式驱动绘图

| 模式 | 画什么 |
|---|---|
| `plain` | 单曲线，y 轴按表达式自适应 |
| `compare` | 多曲线对比（共享窗口，各自独立采样） |
| `tangent` | 指定点的切线（数值微分，Fornberg 单模板） |
| `riemann` | n 个矩形逼近定积分（n 可调） |
| `taylor` | 泰勒展开到 n 阶（展开点可选） |
| `data` | 折线 / 柱状 / 散点 / 饼图 |

带 `params` 时出参数滑块（拖 A、ω、φ 看波形变化，第一个参数可播放动画）；拖拽期间 **y 窗口冻结**（窗口取参数盒角点的并集，一次算定），另有追踪读数：悬停、点按钉住、键盘 `←/→` 步进。卡片交互态**全在组件本地**，不写回 spec、不发 Host 调用 —— 卸载重建必然回到 AI 声明的原值。

---

## 三、安装

### 方式一：link 安装（当前可用）

```bash
# 1. 构建浏览器半边（client 半必须是预构建产物，客户端模块系统读 lib/client.js 原样下发）
cd packages/client-ui-sketch && node build-client.mjs
cd packages/client-ui-cards  && node build-client.mjs

# 2. 装进 profile（官方命令，实为 pnpm 包装器）
dsh plugin --profile <profile> add link:<本仓库绝对路径>/packages/sketch-bundle
dsh --profile <profile> --dump-config    # 应见 4 行 insert
```

桌面端应用（Electron）**必须走它自己的插件面板**，不能手改文件、也不能用 CLI（`profile "desktop" is managed exclusively by the Electron application`）；面板支持填本地目录绝对路径。

⚠️ **改完 client 半要重启应用**（HMR 默认 `root: []`，什么都不 watch）；**改完 Host 半（`cards-core` / `cards-tool` / `sketch-core` / `sketch-tool`）同样要重启** —— 它们是启动时装载的模块。

### 方式二：发布到 npm 前必做两件事

当前仓库里包名是私有作用域 `@gk/*`，直接发 npm 会失败。要么换成你的作用域（`@your-scope/cards-core`），要么用不带作用域的名字（`dsh-aisketch-cards-core`）：

```bash
# 全仓一次性改名（含 import、cordis.patch.yml 的 name、包间依赖）
grep -rl '@gk/' packages | xargs sed -i 's|@gk/|@your-scope/|g'
# 然后把各包 package.json 的 "private": true 去掉，再 pnpm publish -r
```

`private: true` 是有意保留的：本仓库按"link 安装"发布，避免误发私域包名。

---

## 四、架构

七个包，全部 `@gk/*` 作用域，**base 仓一行未改**：

| 包 | 职责 | 测试 |
|---|---|---|
| `packages/cards-core` | 卡片契约内核：`CardSpec` 版本化信封、限额校验、`table` / `flowchart` 载荷解析。零依赖 | 61 |
| `packages/cards-tool` | Host 工具 `show_card`：schema、拒绝原因、摘要、presentationMeta | 15 |
| `packages/client-ui-cards` | 浏览器半边：`card` 聊天节点 + turnTail 产出物面，`CardView` 按 `spec.kind` 经 registry 派发；原生渲染器 `table` / `flowchart` | 68 |
| `packages/sketch-core` | 纯函数内核：表达式 parser（自写 Pratt，无 eval）、参数摘要化、几何采样。零依赖 | 58 |
| `packages/sketch-tool` | Host 工具 `sketch_function`：schema、校验、摘要、presentationMeta | 28 |
| `packages/client-ui-sketch` | 浏览器半边：`tool.call.toolview` 过程行 + turnTail 产出物卡，同一 `SketchFigure`（Canvas + 滑块 + 追踪读数） | 34 |
| `packages/sketch-bundle` | 装配包：`dsh.bundle.patch` → `cordis.patch.yml`（4 行 insert） | — |

**合计 264 例单元/集成测试**，六个包 `tsc --noEmit` 全清。

### 两张脸

| 面 | 槽位 | 何时可见 |
|---|---|---|
| 过程行 | `tool.call.toolview`（key = 工具名） | 回合进行中、折叠区打开时实时出图 |
| 产出物 | `conversation.chat.turnTail` | 回合结束后常驻，**折叠策略管不到**；四档（简洁/标准/详细/完全展开）都可见 |

两张脸共用同一个视图组件（`SketchFigure` / `CardView`），各自只负责取数据：toolview 读工具结果的 `presentationMeta`，turnTail 读按回合累计的 Location data —— 数据源都是**持久化的事件**，所以重放一个会话画出**一模一样**的卡片，不需要 Host 参与。

### 数据流

```
模型调用 show_card(kind, payload)
  → Host 用 cards-core 校验信封（不合法就地拒绝，附原因）
  → 落一条 tool/call 事件（参数是 JSON 文本，回放的唯一数据源）
  → 客户端投影出 card 节点（toolview 面）
  → 同一个 payload 由 turnTail 面再画一次（产出物面）
  → CardView 按 kind 从 registry 取渲染器；没人认领就落 raw 兜底
```

---

## 五、验收与踩坑（都留了证据，不写"应该没问题"）

真机验收（运行中的桌面应用，肉眼 + 像素回读）：

- `sin(x)` 函数图：canvas 回读 **曲线 4449 px、坐标轴 979 px**（空白画布会得到 0），两个完整周期，`errors: 0`。
- `flowchart`：5 节点 5 连线的 if~else 图，截图读到胶囊起点、菱形判断、是/否两条分支、两个箭头汇入终点。
- 四档模式矩阵逐档实测：卡片都直接出现，不需要展开任何折叠区。

三条**踩过的坑**（写进代码注释与测试，别改回去）：

1. **折叠豁免名单不含任何工具节点。** 只注册 toolview 的卡片，回合结束后在"简洁/标准/详细"三档**什么都看不到**——而且展开「已调用工具」组头也够不到（它挂在外层回合过程披露上）。这是本项目两次踩同一个坑的原因（先函数图、后卡片）。
2. **turnTail 的 Turn 数据发布键必须等于 Definition 自己的 kind。** 有一版 kind 叫 `card-tail` 却往 `card` 键发布，单测全绿 —— 直到第一条真实调用流过事件流，装配器抛 `published Location data key "card"; expected its owned kind`，整个 client entry 没激活、应用弹「无法启动」。现在有回归钉。
3. **桌面端不是通过 HTTP 渲染的。** 底座文档写明"Electron 通过 `file://` 加载 dist，并经 IPC 桥接承载 fetch"，所以对 `http://127.0.0.1:<port>/plugins/...` 探测得 404 **不能**证明插件行没注册 —— 要验客户端只能人眼看 DOM 或挂 CDP。

另有两条实现纪律：流程图**回边不参与排名松弛**（否则重试回路会把目标推到右边、排名塌掉），**共享端点必须扇开**（同一节点两条入边落同一锚点会叠成一条线）。

---

## 六、已知限制

- 「完全展开」档下，卡片会在**过程行**与**产出物行**各出现一次（两张脸同时可见）。这是插件与折叠策略相互作用的结果，未做去重。
- 「轨迹」页看不到卡片：卡片的 view target 是 `chat`，轨迹页按设计只显示原始调用。
- Host 半改动需要重启应用；client 半改动需要重建 `lib/client.js` 并重启（无 HMR）。
- `desktop` profile 被 Electron 应用独占，只能用应用内插件面板安装。

## 七、常用命令

```bash
pnpm install                      # 装依赖（NODE_OPTIONS 需清空）
pnpm test                         # 六个包 264 例
pnpm typecheck                    # 六个包 tsc --noEmit
pnpm build:client                 # 重建两个 client 半 → lib/client.js
```

## 许可

MIT © 2026 QinLuza
