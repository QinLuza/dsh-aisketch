/**
 * Reading a plot spec out of the bytes the Host persisted.
 *
 * Shared by the toolview card and the completed-Turn tail so the two surfaces
 * cannot drift on what counts as a drawable result.
 */
import type { SketchSpec } from '@gk/sketch-core'

/**
 * Narrow the persisted presentation metadata to the spec this plugin understands.
 * @param meta - `tool/result` metadata, untyped on the wire.
 * @returns the spec when it carries a non-empty expression, otherwise null.
 */
export function readSpec(meta: unknown): SketchSpec | null {
  if (typeof meta !== 'object' || meta === null) return null
  const spec = (meta as { spec?: unknown }).spec
  if (typeof spec !== 'object' || spec === null) return null
  const expr = (spec as { expr?: unknown }).expr
  if (typeof expr !== 'string' || expr.length === 0) return null
  return spec as SketchSpec
}
