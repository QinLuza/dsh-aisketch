/** `sketch` namespace dictionaries for the AISketch tool card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sketch'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.title': '函数图',
  'card.preparing': '正在绘图',
  'card.failed': '绘图失败',
  'card.stopped': '绘图已中止',
  'card.empty': '没有可绘制的内容',
  'card.inspect': '查看',
  'card.animate': '播放动画',
  'card.pause': '暂停',
  'card.reset': '重置',
  'card.param': '参数',
  'card.readoutHint': '悬停、点按或按方向键取值',
  'card.expand': '放大显示',
  'card.close': '关闭',
  'mode.plain': '单曲线',
  'mode.compare': '曲线对比',
  'mode.tangent': '切线',
  'mode.riemann': '黎曼和',
  'mode.taylor': '泰勒展开',
  'mode.data': '数据图表',
} satisfies Record<string, string>

/** The sketch namespace key union. */
export type SketchKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.title': 'Function graph',
  'card.preparing': 'Drawing',
  'card.failed': 'Drawing failed',
  'card.stopped': 'Drawing stopped',
  'card.empty': 'Nothing to draw',
  'card.inspect': 'Inspect',
  'card.animate': 'Play animation',
  'card.pause': 'Pause',
  'card.reset': 'Reset',
  'card.param': 'Parameters',
  'card.readoutHint': 'Hover, tap, or use the arrow keys to read values',
  'card.expand': 'Expand',
  'card.close': 'Close',
  'mode.plain': 'Curve',
  'mode.compare': 'Comparison',
  'mode.tangent': 'Tangent',
  'mode.riemann': 'Riemann sum',
  'mode.taylor': 'Taylor series',
  'mode.data': 'Data chart',
} satisfies Record<SketchKey, string>
