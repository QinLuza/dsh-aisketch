# 截图复现提示词

这些提示词用于生成 `docs/assets/screenshots/` 里的卡片。它们刻意把工具和参数写死，避免模型改用 Markdown、ASCII 或写文件。

## 1. sketch_function 六模式

> 只依次调用 sketch_function 六次，每次一张卡，不要调用其他工具、不要写文件、不要额外讲解：
> 1) `expr="sin(x)"`；
> 2) `expr="x^2", mode="compare", curves=["2x"]`；
> 3) `expr="x^2", mode="tangent", probe=1`；
> 4) `expr="sin(x)", mode="riemann", a=0, b=3.141592653589793, n=12`；
> 5) `expr="exp(x)", mode="taylor", order=5, center=0`；
> 6) `expr="sample", mode="data", dataset="bar"`。
> 六次调用按顺序给出，最终回复只写「已完成」。

## 2. table + flowchart

> 只依次调用 show_card 两次，不要调用其他工具、不要写文件、不要额外讲解：
> 1) `kind="table", title="常用物理量", payload={"columns":["物理量","符号","单位","量纲"],"rows":[["速度","v","m/s","L·T⁻¹"],["加速度","a","m/s²","L·T⁻²"],["力","F","N","M·L·T⁻²"],["功","W","J","M·L²·T⁻²"]]}`；
> 2) `kind="flowchart", title="奇偶判断", payload={"nodes":[{"id":"start","label":"开始","shape":"terminal"},{"id":"input","label":"输入整数 n","shape":"process"},{"id":"check","label":"n 是偶数？","shape":"decision"},{"id":"even","label":"输出 n/2","shape":"process"},{"id":"odd","label":"输出 3n+1","shape":"process"},{"id":"end","label":"结束","shape":"terminal"}],"edges":[{"from":"start","to":"input"},{"from":"input","to":"check"},{"from":"check","to":"even","label":"是"},{"from":"check","to":"odd","label":"否"},{"from":"even","to":"end"},{"from":"odd","to":"end"}]}`。
> 两次调用按顺序给出，最终回复只写「已完成」。

流程图截图在卡片右上角的放大视图中截取，以完整显示横向布局。

## 3. figure 四模板

> 只依次调用 show_card(kind="figure") 四次，不要用 draw，不要写文件，不要解题或额外讲解：
> 1) `title="斜面受力分析", payload={"template":"incline_force","params":{"angleDeg":30,"massKg":2,"frictionCoeff":0.2,"showValues":true}}`；
> 2) `title="桌面连接体", payload={"template":"connected_bodies","params":{"surfaceMassKg":2,"hangingMassKg":1,"frictionCoeff":0.2,"showValues":true}}`；
> 3) `title="Zn 电子排布", payload={"template":"orbital_diagram","params":{"symbol":"Zn"}}`；
> 4) `title="Na 原子壳层", payload={"template":"atom_shell","params":{"symbol":"Na","showShellCounts":true}}`。
> 四次调用按顺序给出，最终回复只写「已完成」。

## 4. draw 手绘插画

> 只用 show_card(kind="draw") 画一张手绘插画风的山湖小屋，横构图，size 用 1200x800，不要标题、标签、胶带，也不要 canvas-design，也不要写文件。可以先提交一次 draft:true 的内部预览自查，但只把最终稿给我，不要输出中间版本。

截图取最终稿（132 elements / 1200×800）；私有 draft 不会出现在会话里。

## 裁剪口径

- 用真实 DSH 会话渲染，截取卡片节点（含卡片标题行）的边界。
- 不包含侧边栏、账号、模型选择器、输入框或会话正文。
- 流程图使用放大弹窗，避免横向布局被卡片宽度截断。
