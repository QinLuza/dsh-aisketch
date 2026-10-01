/**
 * Card styling, carried as a plain stylesheet instead of a CSS module.
 *
 * The browser half ships as one prebuilt bundle that the client module system
 * reads off disk and serves verbatim (`packages/client/modules` reads
 * `./client` with `readFileSync`); there is no CSS-modules pipeline on that
 * path, so an `import styles from '*.module.css'` would never resolve at
 * runtime. Injecting a real stylesheet keeps the cascade, the `:hover` rule
 * and the `--dsw-alias-*` design tokens, all of which plain inline styles
 * would lose.
 *
 * Class names are `sk-` prefixed because they are global once injected.
 */

/** The injected `<style>` id, so the sheet is appended exactly once. */
const STYLE_ID = 'aisketch-card-styles'

/** Plain class names, keyed by role. */
export const CLS = {
  card: 'sk-card',
  head: 'sk-head',
  title: 'sk-title',
  chip: 'sk-chip',
  action: 'sk-action',
  canvas: 'sk-canvas',
  params: 'sk-params',
  paramsLabel: 'sk-params-label',
  paramRow: 'sk-param-row',
  paramName: 'sk-param-name',
  paramRange: 'sk-param-range',
  paramValue: 'sk-param-value',
  empty: 'sk-empty',
} as const

const SHEET = `
.${CLS.card} {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}
.${CLS.head} {
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(24px + var(--dsh-content-font-delta, 0px));
  min-width: 0;
}
.${CLS.title} {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: calc(13px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-primary, #1f1f1f);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CLS.chip} {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 80%, #378add);
  color: var(--dsw-alias-text-secondary, #5f6368);
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
}
.${CLS.action} {
  flex: none;
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-text-secondary, #5f6368);
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  cursor: pointer;
}
.${CLS.action}:hover {
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 92%, #378add);
}
.${CLS.canvas} {
  display: block;
  max-width: 100%;
  border: 1px solid var(--dsw-alias-border-base, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
  cursor: crosshair;
  touch-action: pan-y;
}
.${CLS.canvas}:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 40%, #378add);
  outline-offset: 1px;
}
.${CLS.params} {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-secondary, #5f6368);
}
.${CLS.paramsLabel} {
  opacity: 0.75;
}
.${CLS.paramRow} {
  display: flex;
  align-items: center;
  gap: 8px;
}
.${CLS.paramName} {
  flex: none;
  width: 1.5em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.${CLS.paramRange} {
  flex: 1 1 auto;
  max-width: 320px;
  accent-color: #378add;
}
.${CLS.paramValue} {
  flex: none;
  width: 5.5em;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.${CLS.empty} {
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-text-secondary, #5f6368);
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
