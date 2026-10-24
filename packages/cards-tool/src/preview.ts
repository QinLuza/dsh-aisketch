/**
 * The `show_card` preview: a drawing comes back to the model as a picture.
 *
 * A model authors a `draw` card as coordinates and then never sees it -- it goes
 * straight into the transcript while the model waits to be judged on it. That is
 * the single biggest reason the drawings come out composed badly: the author is
 * blind. This module closes the loop. It rasterizes the very ink the browser is
 * about to paint, commits it as an image attachment, and the tool returns it in
 * its own result, so the next step of the same turn already has the picture.
 *
 * Two gates are deliberately soft. A route that does not declare image input
 * cannot read a preview, and a deployment without an attachment store cannot
 * carry one -- in both cases the card still goes out and the caller still gets
 * the text self-check, because a drawing tool must never fail for want of a
 * camera.
 *
 * The service lookups are structural on purpose: `attachments` and `llm` are
 * optional services here, reached through `ctx.get` rather than injected, and
 * depending on their type packages would make a card tool depend on the image
 * pipeline it is trying to use loosely.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DrawPayload } from '@aisketch/cards-core'
import { buildDrawDisplayList } from '@aisketch/cards-core'
import { rasterizeDisplayListPng } from './raster.ts'

/** The image reference shape the harness's `image` content block carries. */
export interface PreviewAttachment {
  readonly attachmentId: string
  readonly mediaType: 'image/png'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** The subset of the attachment store a preview needs. */
interface AttachmentSaver {
  saveImage(input: { data: Uint8Array; mediaType: 'image/png'; name: string }): Promise<PreviewAttachment>
  readonly imageLimits: {
    readonly mediaTypes: readonly string[]
    readonly maxImageBytes: number
    readonly maxMessageImageBytes: number
  }
}

/** The subset of the model registry the route gate needs. */
interface RouteInspector {
  resolveModelInfo(
    provider: string,
    model: string,
    signal: AbortSignal,
  ): Promise<{ readonly inputModalities?: readonly string[] }>
}

/** What the tool registration actually needs to hand back an image. */
export interface PreviewResult {
  readonly attachment: PreviewAttachment
}

/** Why a preview was not produced, phrased for the model rather than a log. */
export type PreviewOutcome =
  | { readonly ok: true; readonly preview: PreviewResult }
  | { readonly ok: false; readonly skipped: string }

/**
 * Reach an optional cordis service without declaring a hard dependency on it.
 *
 * The dependency direction matters here: a card renderer that requires the
 * attachment service would not load in a headless or CLI host, and cards are
 * useful there too. `ctx.get` asks "is it there", which is exactly the question.
 * @param ctx - the Host context.
 * @param name - the cordis service name.
 * @returns the service, or undefined when this host does not mount it.
 */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(service: string): T | undefined }).get(name)
}

/** The model route currently answering, from the request header first. */
export function routeOf(exec: {
  readonly agent?: {
    readonly session: {
      requestHeader(): { readonly config?: { readonly provider?: string; readonly model?: string } | undefined } | undefined
    }
    readonly options: { readonly provider?: string; readonly model?: string }
  }
}): { provider: string | undefined; model: string | undefined } {
  const routed = exec.agent?.session.requestHeader()?.config
  return {
    provider: routed?.provider ?? exec.agent?.options.provider,
    model: routed?.model ?? exec.agent?.options.model,
  }
}

/**
 * Decide whether this route can read a picture at all.
 * @param ctx - the Host context.
 * @param provider - the routed provider id.
 * @param model - the routed model id.
 * @param signal - the call's abort signal.
 * @returns undefined when a preview may be returned, otherwise the reason it may not.
 */
async function imageGate(
  ctx: Context,
  provider: string,
  model: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const llm = optionalService<RouteInspector>(ctx, 'llm')
  if (llm === undefined) return 'the model registry is not available, so a preview image cannot be attached'
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
      return `model "${model}" does not declare image input, so the drawing preview was not attached (the self-check below still applies)`
    }
    return undefined
  } catch {
    return 'the model route could not be inspected, so the drawing preview was not attached'
  }
}

/**
 * Rasterize a drawing and commit the result as a preview image.
 * @param ctx - the Host context; `attachments` and `llm` are looked up optionally.
 * @param draw - the parsed drawing.
 * @param route - the provider/model currently answering.
 * @param signal - the call's abort signal.
 * @returns the attachment reference, or the reason the preview was skipped.
 */
export async function buildDrawPreview(
  ctx: Context,
  draw: DrawPayload,
  route: { readonly provider: string | undefined; readonly model: string | undefined },
  signal: AbortSignal,
): Promise<PreviewOutcome> {
  const attachments = optionalService<AttachmentSaver>(ctx, 'attachments')
  if (attachments === undefined) return { ok: false, skipped: 'this host has no attachment store, so the preview image was not attached' }
  if (!attachments.imageLimits.mediaTypes.includes('image/png')) {
    return { ok: false, skipped: 'this deployment does not accept PNG images, so the preview was not attached' }
  }
  if (route.provider === undefined || route.model === undefined) {
    return { ok: false, skipped: 'the model route could not be resolved, so the preview image was not attached' }
  }
  const refused = await imageGate(ctx, route.provider, route.model, signal)
  if (refused !== undefined) return { ok: false, skipped: refused }

  const list = buildDrawDisplayList(draw)
  // The preview is a self-check, not a deliverable: cap its byte budget against
  // the harness's own per-image and per-message limits by dropping supersampling
  // first, which halves the cost without changing what the picture says.
  let png = rasterizeDisplayListPng(list)
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  if (png.length > byteCap) png = rasterizeDisplayListPng(list, { supersample: 1 })
  if (png.length > byteCap) {
    return { ok: false, skipped: `the preview is ${png.length} bytes, above this deployment's ${byteCap}-byte image limit` }
  }

  const attachment = await attachments.saveImage({ data: png, mediaType: 'image/png', name: 'card-preview.png' })
  return { ok: true, preview: { attachment } }
}
