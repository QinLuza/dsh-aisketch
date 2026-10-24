# Contributing

感谢你对 `dsh-aisketch` 的兴趣。这个仓库是一个独立的 DSH 插件 workspace，不改 DSH base；欢迎 PR、issue 和新的卡片类型。

## 开发

环境：Node.js ≥ 22、pnpm 11。

```bash
pnpm install
pnpm test          # 470 例，必须全绿
pnpm typecheck     # 六个包 tsc --noEmit
pnpm build:client  # 两个 lib/client.js
```

改完 Host 半（`cards-core` / `cards-tool` / `sketch-core` / `sketch-tool`）需要重启 DSH；改完 client 半（`client-ui-*`）需要重新构建 `lib/client.js` 再重启。**不要在 DSH 运行中重建 client 产物**，否则整批客户端插件会加载失败。

## 加一种卡片 `kind`

以 `figure` 为例，一条完整的链路是：

1. **契约与校验**：在 `packages/cards-core/src/` 增加载荷类型、范围校验、错误文案、摘要；在 `packages/cards-core/tests/` 增加边界测试。
2. **Host 工具描述**：在 `packages/cards-tool/src/index.ts` 的工具描述/系统提示里写清楚「模型给什么、不要给什么」；补 schema 与拒绝原因测试。
3. **浏览器渲染器**：在 `packages/client-ui-cards/src/client/` 增加纯函数几何模块 + React 组件；在 `registry.ts` 注册；在 `wiring` 测试里同步闸门。
4. **两张脸**：确认 `card` 节点与 `turnTail` 都能从持久化事件恢复；`turnTail` 的发布键必须等于 Definition 的 kind。
5. **测试与样张**：单元测试 + 渲染验收；在 `docs/assets/screenshots/` 放一张真实 DSH 截图，并更新 `docs/showcase-prompts.md`。
6. **文档**：更新 README 能力矩阵与 CHANGELOG。

## 设计约束（不要绕过）

- 模型只给结构；坐标、角度、锚点、换行、箭头由确定性引擎算。
- 不执行模型生成的代码：没有 `eval` / `new Function`，不把生成的 HTML/SVG 字符串塞进 DOM。
- 同一 payload 必须得到同一张图；不要在渲染时读时钟、随机数（需要抖动时用 payload 索引做种子 PRNG）或网络。
- 校验在 Host 做；错误信息要让模型能自己改。
- 新卡片要同时挂 `tool.call.toolview` 与 `conversation.chat.turnTail`，否则回合结束后会被「回合过程折叠」藏掉。

## 已知的 dsh 显示行为

有些卡片在默认「简洁 / 标准 / 详细」档位下会被折叠或藏起来，只有切到「完全展开（verbose）」或展开对应回合才能看到。这是 dsh 对回合过程的显示逻辑，不是插件未渲染；相关说明见 README「已知限制」。写 UI 测试时不要把「默认档位下过程区不可见」误判为回归。

## PR 检查清单

- [ ] `pnpm test` 全绿
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm build:client` 成功
- [ ] 新增/修改的卡片有真实 DSH 截图（不含账号、路径、密钥）
- [ ] README / CHANGELOG / 截图提示词已更新
- [ ] 没有把内部路径、私有 scope、provider 配置或个人信息带进仓库

## 行为准则

讨论对事不对人；安全问题请走私密渠道，不要在公开 issue 里贴可利用细节或凭据。
