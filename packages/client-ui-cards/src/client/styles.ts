/**
 * Card styling, carried as a plain stylesheet instead of a CSS module.
 *
 * The browser half ships as one prebuilt bundle that the client module system
 * reads off disk and serves verbatim (`packages/client/modules` reads `./client`
 * with `readFileSync`); there is no CSS-modules pipeline on that path, so an
 * `import styles from '*.module.css'` would never resolve at runtime. Injecting
 * a real stylesheet keeps the cascade, the `:hover` rule and the
 * `--dsw-alias-*` design tokens, all of which plain inline styles would lose.
 *
 * Class names are `cd-` prefixed because they are global once injected.
 */

/** The injected `<style>` id, so the sheet is appended exactly once. */
const STYLE_ID = 'cards-node-styles'

/** Plain class names, keyed by role. */
export const CLS = {
  card: 'cd-card',
  head: 'cd-head',
  title: 'cd-title',
  kind: 'cd-kind',
  summary: 'cd-summary',
  scroll: 'cd-scroll',
  table: 'cd-table',
  th: 'cd-th',
  td: 'cd-td',
  num: 'cd-num',
  empty: 'cd-empty',
  hint: 'cd-hint',
  raw: 'cd-raw',
  chart: 'cd-chart',
  edge: 'cd-edge',
  edgeHead: 'cd-edge-head',
  edgeLabel: 'cd-edge-label',
  edgeLabelBackground: 'cd-edge-label-bg',
  terminalNode: 'cd-node-terminal',
  processNode: 'cd-node-process',
  decisionNode: 'cd-node-decision',
  nodeLabel: 'cd-node-label',
} as const

const SHEET = `
.${CLS.card} {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  min-width: 0;
}
.${CLS.head} {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.${CLS.title} {
  font-size: calc(13px + var(--dsh-content-font-delta, 0px));
  font-weight: 600;
  color: var(--dsw-alias-text-primary, #1f1f1f);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CLS.kind} {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 80%, #378add);
  color: var(--dsw-alias-text-secondary, #5f6368);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
}
.${CLS.summary} {
  margin-left: auto;
  flex: none;
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-secondary, #5f6368);
}
.${CLS.scroll} {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-base, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
}
.${CLS.table} {
  width: 100%;
  border-collapse: collapse;
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
}
.${CLS.th} {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 10px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
  color: var(--dsw-alias-text-primary, #1f1f1f);
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 94%, #378add);
  border-bottom: 1px solid var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12));
}
.${CLS.td} {
  padding: 5px 10px;
  color: var(--dsw-alias-text-secondary, #5f6368);
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-base, rgba(0, 0, 0, 0.08)) 60%, transparent);
}
.${CLS.num} {
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}
.${CLS.empty} {
  padding: 10px;
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-secondary, #5f6368);
}
.${CLS.hint} {
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-secondary, #5f6368);
}
.${CLS.raw} {
  margin: 0;
  padding: 8px 10px;
  max-height: 260px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-secondary, #5f6368);
  white-space: pre-wrap;
  word-break: break-word;
}
.${CLS.chart} {
  display: block;
}
.${CLS.edge} {
  fill: none;
  stroke: var(--dsw-alias-text-secondary, #5f6368);
  stroke-width: 1.5;
}
.${CLS.edgeHead} {
  fill: var(--dsw-alias-text-secondary, #5f6368);
}
.${CLS.edgeLabel} {
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  fill: var(--dsw-alias-text-secondary, #5f6368);
}
.${CLS.edgeLabelBackground} {
  fill: var(--dsw-alias-bg-base, #fff);
}
.${CLS.terminalNode} {
  fill: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 86%, #378add);
  stroke: #378add;
  stroke-width: 1.5;
}
.${CLS.processNode} {
  fill: var(--dsw-alias-bg-base, #fff);
  stroke: var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12));
  stroke-width: 1.5;
}
.${CLS.decisionNode} {
  fill: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 92%, #378add);
  stroke: #378add;
  stroke-width: 1.5;
}
.${CLS.nodeLabel} {
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  fill: var(--dsw-alias-text-primary, #1f1f1f);
}
`

/**
 * Append the sheet to `document.head` once per page.
 * Runs at import time; safe to call repeatedly because of the id guard.
 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = SHEET
  document.head.appendChild(element)
}