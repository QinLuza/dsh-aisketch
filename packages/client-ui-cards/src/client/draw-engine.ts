/**
 * The `draw` engine, re-exported from the shared kernel.
 *
 * The geometry moved to `@aisketch/cards-core` so the Host can rasterize exactly the
 * ink the browser paints -- `show_card` renders a preview of a drawing and hands
 * it back to the model, and a preview is only worth reading if it is the same
 * picture. This module stays as the browser half's named entry point, so every
 * importer and every test keeps resolving the same names.
 *
 * Nothing else belongs here: a local copy would be a private fork of the
 * engine, and the preview would then disagree with the card.
 */

export * from '@aisketch/cards-core'
