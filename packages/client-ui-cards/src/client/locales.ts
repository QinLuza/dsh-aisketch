/** `cards` namespace dictionaries for the generic card surface. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'cards'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'unknown.title': '未知卡片',
  'unknown.hint': '这张卡片来自更新的渲染器，暂时以原始数据展示。',
  'broken.title': '卡片数据无法解析',
  'broken.hint': '这次调用没有产出可渲染的卡片，原始参数如下。',
  'table.title': '数据表',
  'table.empty': '没有数据行',
  'table.summary': '{rows} 行 · {columns} 列',
  'flowchart.title': '流程图',
  'flowchart.summary': '{nodes} 个节点 · {edges} 条连线',
  'draw.title': '手绘',
  'draw.summary': '{elements} 个元素 · {w}×{h}',
  'figure.title': '科学示意图',
  'figure.summary.incline': '{angle}° · {mass} kg · μ {friction}',
  'figure.summary.connected': 'm₁ {surface} kg · m₂ {hanging} kg · μ {friction}',
  'figure.summary.orbital': '{symbol} · Z={z} · 电子排布/轨道图',
  'figure.summary.atom': '{symbol} · Z={z}',
  'card.expand': '放大显示',
  'card.close': '关闭',
} satisfies Record<string, string>

/** The cards namespace key union. */
export type CardKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'unknown.title': 'Unknown card',
  'unknown.hint': 'This card comes from a newer renderer; showing its raw payload.',
  'broken.title': 'Unreadable card',
  'broken.hint': 'This call produced no renderable card; its raw arguments are below.',
  'table.title': 'Table',
  'table.empty': 'No rows',
  'table.summary': '{rows} rows · {columns} columns',
  'flowchart.title': 'Flowchart',
  'flowchart.summary': '{nodes} nodes · {edges} edges',
  'draw.title': 'Sketch',
  'draw.summary': '{elements} elements · {w}×{h}',
  'figure.title': 'Scientific figure',
  'figure.summary.incline': '{angle}° · {mass} kg · μ {friction}',
  'figure.summary.connected': 'm₁ {surface} kg · m₂ {hanging} kg · μ {friction}',
  'figure.summary.orbital': '{symbol} · Z={z} · electron configuration',
  'figure.summary.atom': '{symbol} · Z={z}',
  'card.expand': 'Expand',
  'card.close': 'Close',
} satisfies Record<CardKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The generic card surface's copy. */
    cards: CardKey
  }
}