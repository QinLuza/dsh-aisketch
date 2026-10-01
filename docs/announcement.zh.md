# 社区宣传稿 · dsh-aisketch

> 用途：发到 DSH 社区 / GitHub Release / 论坛。可直接复制；方括号处按平台替换。
> 配套仓库：`dsh-aisketch`（MIT）

---

## 标题候选

- **给 DSH 加一条"模型出结构、客户端作图"的卡片通道**（推荐）
- DSH 插件：让模型画表格和流程图，而不是写一坨 ASCII
- 零 base 改动，给 DSH 装上数据表 / 流程图 / 函数图三种卡片

---

## 正文

**一句话**：`dsh-aisketch` 给 DSH 加了两条通道 —— `show_card`（模型给 `kind + payload`，会话里出**原生卡片**：数据表、SVG 流程图）与 `sketch_function`（模型给一条表达式，出**可交互函数图像**）。**零 base 改动**，MIT。

### 解决什么问题

模型想把一件事讲清楚时，手上只有文字。于是它写 Markdown 表格、画 ASCII 图，或者更糟 —— 生成一段 HTML/SVG 让你渲染。前两者难看且难读，后者是**执行模型生成的代码**，还不可回放。

`dsh-aisketch` 换了条路：**模型只交结构，几何由确定性引擎算**。

```
show_card(kind: "flowchart", payload: {
  nodes: [{ id: "start", label: "输入", shape: "terminal" }, …],
  edges: [{ from: "check", to: "ok", label: "是" }, …]
})
```

位置、换行、箭头锚点、分支扇开全在客户端算 —— 没有 `eval`、没有 `new Function`、不把生成的标记塞进 DOM。同一份 payload 必然画出同一张图，所以**回放一个旧会话，卡片一模一样**。

### 现在能画什么

| 工具 | 能力 |
|---|---|
| `show_card` → `table` | 1..12 列、≤500 行；表头吸顶、数字右对齐等宽、空值显示 `--` |
| `show_card` → `flowchart` | 1..40 节点、≤80 连线；胶囊起止、菱形判断、分支标签、回边绕右侧 |
| `show_card` → 任意 kind | raw 兜底：标题 + kind 芯片 + 原始负载，**卡片永不静默消失** |
| `sketch_function` | 单曲线 / 多曲线对比 / 切线 / 黎曼和 / 泰勒展开 / 数据图表；参数滑块 + 播放；追踪读数（悬停、点按钉住、键盘步进） |

模型侧的 token 开销很小：画一张函数图实测 **4–45 token**（只给表达式和范围）。

### 一个不显眼但关键的坑：卡片会被"折叠"藏起来

如果你也写过 DSH 客户端插件，这条能省你半天：

工具调用按定义属于「**回合过程**」，而过程会被工作步骤展示模式折叠 —— `ui-chat` 的豁免名单只列了 8 种回合骨架 kind，**没有任何工具节点**。所以只注册 `tool.call.toolview` 的卡片，回合一结束就在「简洁/标准/详细」三档里**彻底看不见**，而且展开「已调用工具」组头也够不到它（它挂在外层回合过程披露上）。

解法：卡片要**两张脸**。过程行给进行中的实时反馈，产出物挂 `conversation.chat.turnTail` —— 那是 base 留给产出物的槽位（官方改动文件卡就走这条），**豁免折叠，四档都可见**。本插件的表格/流程图/函数图都是这么挂的。

### 与 DSH 本体的关系（不重复造轮子）

- 本体**已有**：每个内置工具自己的卡片模型（read / grep / diff / terminal / web / ask_user_question …，一一写死在客户端）、`present`（把**已有文件**声明为交付物，只记路径不搬内容）。
- 本体**没有**：让模型自选内容的通用卡片通道，也没有任何绘图/图表/流程图工具 —— 官方工具目录 101 个工具条目里一个都没有（实据：base 仓 `grep -r "show_card\|sketch_function"` = 0 命中）。
- 本插件补的正是这一格，而且**加一种新卡片 = 注册一个渲染器**，不动聊天节点契约、不动 base。

### 安装（link 安装，三行）

```bash
cd packages/client-ui-sketch && node build-client.mjs
cd packages/client-ui-cards  && node build-client.mjs
dsh plugin --profile <profile> add link:<repo>/packages/sketch-bundle
```

桌面端应用请用它自己的**插件面板**（填目录绝对路径）—— `desktop` profile 被 Electron 独占，CLI 装不进去。改完 client 半要重启应用（没有 HMR）。

### 质量与证据

- **264 例**单元/集成测试，六个包 `tsc --noEmit` 全清。
- 真机验收不是"没报错"：函数图 canvas 像素回读（曲线 4449 px、坐标轴 979 px，空白画布会是 0）；流程图截图读到胶囊起点、菱形判断、是/否两条分支与汇合箭头。
- 有回归钉：*少注册任一张脸* 会红（做过"能失败的对照组"），*turnTail 发布键写错* 会红（这一条是真崩过应用才补上的）。

### 已知限制（照实说）

- 「完全展开」档下卡片会出现两次（过程行 + 产出物行），未做去重。
- 「轨迹」页看不到卡片 —— 卡片的 view target 是 `chat`，轨迹页按设计只显示原始调用。
- 目前是 link 安装；发 npm 需要先把私有作用域换成你自己的（README 有一步到位的改名命令）。

---

**仓库**：[GitHub](https://github.com/QinLuza/dsh-aisketch) · **许可**：MIT ·
**欢迎**：注册你自己的卡片 kind（一个 PR 加一个组件 + 一个载荷解析器）；用出问题请带 `show_card` 的原始参数开 issue。

---

## 短版（适合发一条动态 / 群消息）

> 给 DSH 写了个插件 **dsh-aisketch**（MIT）：模型不用再写 ASCII 表或生成 HTML —— 它交 `kind + payload`，客户端出**原生卡片**：数据表、SVG 流程图；另一个工具 `sketch_function` 让它一条表达式就画出可交互的函数图像（切线/黎曼和/泰勒展开都行）。
> 零 base 改动，全靠官方槽位。踩过最深的坑：卡片只挂 `toolview` 会被「回合过程折叠」藏掉，必须同时挂 `turnTail` 产出物槽位才能在四档模式下常驻可见。
> 264 例测试全绿，真机像素级验收。仓库：[…]
