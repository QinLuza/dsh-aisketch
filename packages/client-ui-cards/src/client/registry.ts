/**
 * Client-side renderer registry for the generic card channel.
 *
 * A card names its renderer by `kind`, so adding a card type is registering a
 * component -- never a new chat node kind, never a base-contract change. The
 * registry is also the trust boundary's seat: every entry declares whether it
 * is `native` (a component in the application's own React tree, inheriting
 * theme, locale and dark mode) or `sandboxed` (arbitrary author markup in an
 * isolated frame that deliberately gives those up). A deployment can therefore
 * forbid one grade without touching a single card.
 *
 * The registry is a tiny external store, not just a map: a plugin that
 * activates after a card is already on screen must be able to claim it, so
 * {@link subscribeCardRenderers} is what the node view subscribes through.
 */

import type { ComponentType } from 'react'
import { CARD_KIND_PATTERN, MAX_KIND_LENGTH } from '@gk/cards-core'
import type { CardSpec } from '@gk/cards-core'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { NS } from './locales.ts'

/** Trust grade a renderer runs at. */
export type CardTrust = 'native' | 'sandboxed'

/** Props every card renderer receives: the admitted spec and this plugin's copy. */
export interface CardRendererProps {
  readonly card: CardSpec
  /** Namespace-bound translate for the `cards` dictionary. */
  readonly t: TranslateNS<typeof NS>
}

/** One registration: who owns the kind, how much it is trusted, and what it draws. */
export interface CardRendererEntry {
  /** Registrant identity; re-registering the same id is idempotent, a clash throws. */
  readonly id: string
  readonly trust: CardTrust
  readonly component: ComponentType<CardRendererProps>
}

const renderers = new Map<string, CardRendererEntry>()
const listeners = new Set<() => void>()
let version = 0

/** Publish a registry change to every subscribed view. */
function notify(): void {
  version += 1
  for (const listener of [...listeners]) listener()
}

/**
 * Claim one `kind`.
 *
 * Idempotent for the same registrant: a plugin re-applied by HMR or by a
 * profile reload re-registers the identical entry and must not throw. A
 * *different* registrant claiming an occupied kind is a real conflict -- two
 * cards cannot both own `table` -- so it throws instead of silently winning.
 * @param kind - renderer key, in the CardSpec `kind` syntax.
 * @param entry - registrant identity, trust grade, and component.
 * @returns the disposer that releases the kind.
 */
export function registerCardRenderer(kind: string, entry: CardRendererEntry): () => void {
  if (kind.length === 0 || kind.length > MAX_KIND_LENGTH || !CARD_KIND_PATTERN.test(kind)) {
    throw new Error(`card renderer kind "${kind}" is not a valid kind`)
  }
  const existing = renderers.get(kind)
  if (existing !== undefined) {
    if (existing.id !== entry.id) {
      throw new Error(`card renderer "${kind}" is already registered by ${existing.id}`)
    }
    return () => {}
  }
  renderers.set(kind, entry)
  notify()
  return () => {
    if (renderers.get(kind) !== entry) return
    renderers.delete(kind)
    notify()
  }
}

/**
 * Look up the renderer for one kind.
 * @param kind - the spec's `kind`.
 * @returns the entry, or undefined when nothing claims it yet.
 */
export function cardRenderer(kind: string): CardRendererEntry | undefined {
  return renderers.get(kind)
}

/** @returns every claimed kind, for diagnostics and the empty-state copy. */
export function cardRendererKinds(): readonly string[] {
  return [...renderers.keys()]
}

/**
 * Subscribe to registry changes.
 * @param listener - called after any claim or release.
 * @returns the unsubscribe function.
 */
export function subscribeCardRenderers(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Read the registry revision.
 * Stable between changes, which is what `useSyncExternalStore` requires.
 * @returns the current revision.
 */
export function cardRendererVersion(): number {
  return version
}