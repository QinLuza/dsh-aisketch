/**
 * Generic in-conversation card contract.
 *
 * A card is *data, not code*: one versioned declarative {@link CardSpec} that
 * any Host tool can produce and one browser renderer registry can draw. That
 * choice is what makes a card replayable from the transcript (the Host
 * recomputes nothing), forward-compatible (an unknown `kind` still reaches the
 * client and degrades to a visible raw view instead of vanishing), and safe to
 * accept from a model (a renderer never evaluates the payload).
 *
 * Both halves share this module: the Host tool validates its arguments before
 * running, and the browser projection parses the very same shape back out of
 * the persisted `tool/call` arguments.
 */

import { FIGURE_KIND, checkFigurePayload, parseFigurePayload, summarizeFigure } from './figure.ts'

/** Wire name of the Tool that emits a card; the client projects its node on it. */
export const CARD_TOOL_NAME = 'show_card'

/** Contract version carried by every spec. Bump only for a breaking envelope change. */
export const CARD_SPEC_VERSION = 1

/** `kind` syntax: an identifier-shaped token, so a kind is never a path or a URL. */
export const CARD_KIND_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/

/** Ceiling on `kind` length. */
export const MAX_KIND_LENGTH = 64

/** Ceiling on `title` length, after trimming. */
export const MAX_TITLE_LENGTH = 200

/**
 * Serialized payload ceiling, measured in UTF-16 code units of
 * `JSON.stringify(payload)` -- one unit per `String.length`, so the limit means
 * the same thing in the Host and in the browser without a UTF-8 encoder.
 */
export const MAX_PAYLOAD_LENGTH = 32 * 1024

/** The tabular `kind` this release renders natively. Anything else stays raw-visible. */
export const TABLE_KIND = 'table'

/** Column ceiling for {@link TABLE_KIND}. */
export const MAX_TABLE_COLUMNS = 12

/** Row ceiling for {@link TABLE_KIND}. */
export const MAX_TABLE_ROWS = 500

/**
 * The diagram `kind` this release renders natively.
 *
 * A flowchart is the second shape that earns a native renderer, and for the
 * same reason the table did: the model can state it as a few dozen tokens of
 * *structure* -- ids, labels, connections -- while the deterministic client-side
 * layout, not the model, decides where the boxes and arrows go. Asking a model
 * for coordinates, or for SVG, would be asking it to draw.
 */
export const FLOWCHART_KIND = 'flowchart'

/** Node ceiling for {@link FLOWCHART_KIND}. */
export const MAX_FLOWCHART_NODES = 40

/** Connection ceiling for {@link FLOWCHART_KIND}. */
export const MAX_FLOWCHART_EDGES = 80

/** Node id ceiling, in characters. */
export const MAX_FLOWCHART_ID_LENGTH = 32

/** Node and connection label ceiling, in characters. */
export const MAX_FLOWCHART_LABEL_LENGTH = 48

/**
 * The sketch `kind` this release renders natively.
 *
 * The third native kind imports the drawing surface of a note app: the model
 * states *strokes* -- pen paths, shapes, labels, tape -- and the deterministic
 * client engine turns them into a hand-drawn picture. As with the flowchart,
 * the model never sends rendered markup: the path grammar below is parsed into
 * commands and never evaluated, and every pen effect (fountain taper,
 * calligraphy nib, pencil grain) is computed from geometry the engine derives,
 * not authored by hand.
 */
export const DRAW_KIND = 'draw'

/** Element ceiling for {@link DRAW_KIND}. */
export const MAX_DRAW_ELEMENTS = 300

/** Ceiling for one path element's `d` length, in characters. */
export const MAX_DRAW_PATH_LENGTH = 1200

/** Ceiling for one text element's characters, newlines included. */
export const MAX_DRAW_TEXT_LENGTH = 160

/** Stroke width bounds for {@link DRAW_KIND} elements. */
export const MIN_DRAW_WIDTH = 0.3
export const MAX_DRAW_WIDTH = 24

/** Canvas width bounds for {@link DRAW_KIND}. */
export const MIN_DRAW_SIZE_W = 120
export const MAX_DRAW_SIZE_W = 1600

/** Canvas height bounds for {@link DRAW_KIND}. */
export const MIN_DRAW_SIZE_H = 100
export const MAX_DRAW_SIZE_H = 1200

/** Default canvas size: fits the chat column without scrolling. */
export const DEFAULT_DRAW_SIZE_W = 640
export const DEFAULT_DRAW_SIZE_H = 400

/** Default stroke width, in canvas units. */
export const DEFAULT_DRAW_WIDTH = 2

/** Default and bounds for a text element's font size. */
export const DEFAULT_DRAW_TEXT_SIZE = 16
export const MIN_DRAW_TEXT_SIZE = 8
export const MAX_DRAW_TEXT_SIZE = 64

/** Coordinate magnitude ceiling: larger is a mistake, not a drawing. */
export const MAX_DRAW_COORD = 4000

/** Tape element bounds: a strip of washi tape, not a banner. */
export const MIN_DRAW_TAPE_W = 8
export const MAX_DRAW_TAPE_W = 400
export const DEFAULT_DRAW_TAPE_H = 26
export const MIN_DRAW_TAPE_H = 8
export const MAX_DRAW_TAPE_H = 120
export const DEFAULT_DRAW_TAPE_ANGLE = -6
export const MIN_DRAW_TAPE_ANGLE = -45
export const MAX_DRAW_TAPE_ANGLE = 45

/** Pixel-art block bounds: characters, not rectangles, are what the model authors. */
export const MIN_PIXEL_CELL = 2
export const MAX_PIXEL_CELL = 48
export const DEFAULT_PIXEL_CELL = 12
export const MAX_PIXEL_ROWS = 120
export const MAX_PIXEL_COLS = 200
export const MAX_PIXEL_CELLS = 8000
export const MAX_PIXEL_PALETTE = 16

/** The pen set, named after a note app's physical pens. */
export const DRAW_PENS = ['ball', 'fountain', 'marker', 'pencil', 'calligraphy', 'brush', 'highlighter'] as const

/**
 * The pens the engine paints as a constant-width *stroke*, so a dash pattern can
 * land on them. The rest (fountain, brush, calligraphy) are variable-width
 * filled outlines -- a dash has nothing to dash -- and that split is asserted
 * against `penSpec` by the tests, because the switch in the engine is the
 * authority and this list is what the model is told.
 */
export const DRAW_STROKE_PENS = ['ball', 'marker', 'pencil', 'highlighter'] as const

/** A pen choice for a path element; `ball` when omitted. */
export type DrawPen = typeof DRAW_PENS[number]

/** Paper backgrounds the renderer can tile. */
export const DRAW_PAPERS = ['plain', 'dots', 'grid', 'lined'] as const

/** Background choice for a drawing; `plain` when omitted. */
export type DrawPaper = typeof DRAW_PAPERS[number]

/** Stroke rhythm for a shape outline. */
export const DRAW_DASHES = ['solid', 'dashed', 'dotted'] as const

/** Dash choice for a shape; `solid` when omitted. */
export type DrawDash = typeof DRAW_DASHES[number]

/** Geometric primitives a shape element can draw. */
export const DRAW_SHAPES = ['rect', 'ellipse', 'line', 'arrow', 'triangle', 'diamond'] as const

/** The primitive a shape element draws. */
export type DrawShapeKind = typeof DRAW_SHAPES[number]

/** Gradient kinds a fill can name. */
export const DRAW_GRADIENT_TYPES = ['linear', 'radial'] as const

/** The gradient kind a fill names. */
export type DrawGradientType = typeof DRAW_GRADIENT_TYPES[number]

/** Stop ceiling for one gradient: a ramp, not a palette dump. */
export const MAX_DRAW_GRADIENT_STOPS = 8

/**
 * Blend modes an element can name, spelled exactly like the CSS property values
 * a model already knows.
 *
 * These are what turn "a warm shape on a scene" into light: a `screen` wash
 * lightens what is under it, a `multiply` wash shades it, and neither needs a
 * new color. `normal` is the default and reproduces the old behaviour.
 */
export const DRAW_BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const

/** The blend mode an element paints with. */
export type DrawBlend = typeof DRAW_BLENDS[number]

/**
 * Blur ceiling for one element, in canvas units.
 *
 * A blur is what makes light a thing rather than a shape: a shaft that ends in
 * a hard wedge reads as painted paper, and the same wedge with a 20-unit spread
 * reads as light. The ceiling keeps a payload from costing a full-canvas buffer
 * with a radius that would erase the picture anyway.
 */
export const MAX_DRAW_BLUR = 120

/** Horizontal alignment of a text element around its x. */
export const DRAW_ANCHORS = ['start', 'middle', 'end'] as const

/** Anchor choice for a text element; `start` when omitted. */
export type DrawTextAnchor = typeof DRAW_ANCHORS[number]

/**
 * Named palette, tuned to stay legible on both card themes. A color field
 * accepts one of these names or `#rgb` / `#rrggbb`; omitting it picks the
 * theme's ink.
 */
export const DRAW_COLORS = {
  black: '#1f1f1f',
  gray: '#8a8f98',
  red: '#c5221f',
  orange: '#e8710a',
  yellow: '#f9ab00',
  green: '#188038',
  teal: '#0f9b8e',
  cyan: '#0aa3c2',
  blue: '#378add',
  purple: '#8430ce',
  pink: '#e64980',
  brown: '#8d6e63',
  white: '#ffffff',
} as const

/** One stop in a {@link DrawGradient}. */
export interface DrawGradientStop {
  /** Position along the gradient, 0..1. Must not decrease across the list. */
  readonly offset: number
  /** Stop color: a palette name or `#rgb`/`#rrggbb`. */
  readonly color: string
  /** Stop alpha, 1 when unset. */
  readonly opacity: number
}

/**
 * A declarative gradient fill.
 *
 * The model never supplies markup or coordinates: it names the ramp and the
 * engine resolves the line (or circle) from the element's own box, so the same
 * payload always ramps the same way. This is what a sky needs -- a ladder of
 * ten translucent bands is both expensive and, at the seams, visibly banded.
 */
export interface DrawGradient {
  readonly type: 'linear' | 'radial'
  /** Two to {@link MAX_DRAW_GRADIENT_STOPS} stops, in non-decreasing `offset` order. */
  readonly stops: readonly DrawGradientStop[]
  /**
   * Linear only: direction in degrees, using the CSS `linear-gradient` angle
   * (0 points up, 90 points right, 180 points down -- the default), so a model's
   * prior for this field is the one that works.
   */
  readonly angle: number
  /** Radial only: centre in canvas units, the element's box centre when unset. */
  readonly center: { readonly x: number; readonly y: number } | undefined
  /** Radial only: radius in canvas units, half the box diagonal when unset. */
  readonly radius: number | undefined
}

/** A fill: one flat color, or a gradient. */
export type DrawFill = string | DrawGradient

/** One freehand stroke: a path in the SVG mini-grammar, drawn with one pen. */
export interface DrawPathElement {
  readonly type: 'path'
  /** Centerline in the {@link parseDrawPathData} grammar; the pen adds the character. */
  readonly d: string
  readonly pen: DrawPen
  readonly color: string | undefined
  readonly width: number
  /**
   * Fill color for the closed subpaths of `d`, or undefined for a line only.
   *
   * Without it a closed outline is an outline forever: hills, roofs and lakes can
   * only ever be bare triangles, which is why a `path` could not carry flat
   * color. Filled subpaths are painted first and the stroke goes on top.
   */
  readonly fill?: DrawFill
  /**
   * Opacity of {@link DrawPathElement.fill}; 1 when unset.
   *
   * Organic masses need translucent washes just as much as geometric ones do.
   * Before this field existed a translucent hill had to be a `shape` triangle
   * or ellipse, which is how a landscape turned into an icon.
   */
  readonly fillOpacity?: number
  /**
   * Multiplier on the pen's own ink opacity, 0..1; 1 when unset.
   *
   * Without it a ballpoint could only be faint by switching to a highlighter --
   * the wrong trade, because the pen carries the stroke's *shape*, not its
   * strength. This is what makes receded background ink, a ghost line under a
   * final one, or an unfinished edge drawable with the pen unchanged.
   */
  readonly strokeOpacity?: number
  /** Dash pattern for the stroke; `solid` when unset, as the engine emits it. */
  readonly dash: DrawDash
  /** How this element's ink combines with what is already painted; `normal` when unset. */
  readonly blend?: DrawBlend
  /** Softening spread in canvas units; 0 or absent keeps a crisp edge. */
  readonly blur?: number
}

/** One geometric primitive, optionally wobbled to look hand-drawn. */
export interface DrawShapeElement {
  readonly type: 'shape'
  readonly shape: DrawShapeKind
  readonly x: number
  readonly y: number
  /** For `line` and `arrow` this is the offset to the far endpoint, so it may be negative. */
  readonly w: number
  readonly h: number
  readonly color: string | undefined
  /** Fill color or gradient, or undefined to draw the outline only. */
  readonly fill: DrawFill | undefined
  /**
   * Opacity of {@link DrawShapeElement.fill}; 0.25 when unset, or 1 when the fill
   * is a gradient, whose stops already carry their own alpha.
   *
   * The default is a wash so a background band cannot erase what was drawn
   * before it. Raise it to 1 for a solid block of color -- which is what a sky
   * band or a lake needs, and what a model means by "fill this with blue".
   */
  readonly fillOpacity?: number
  readonly width: number
  readonly dash: DrawDash
  /**
   * Ink opacity of the outline and any arrowheads, 0..1; 0.95 when unset.
   *
   * Same reason as {@link DrawPathElement.strokeOpacity}: a construction line
   * and a solid edge differ only in strength, and before this field the only way
   * to say "faint" was `dashed`, which changes what the line *is*.
   */
  readonly strokeOpacity?: number
  /** `arrow` only: also draw a head at the start endpoint. */
  readonly arrowStart: boolean
  /** Resolved hand-drawn wobble: the element's own choice, else the payload's. */
  readonly rough: boolean
  /** How this element's ink combines with what is already painted; `normal` when unset. */
  readonly blend?: DrawBlend
  /** Softening spread in canvas units; 0 or absent keeps a crisp edge. */
  readonly blur?: number
}

/** One line of text (newlines allowed), placed by baseline start point. */
export interface DrawTextElement {
  readonly type: 'text'
  readonly x: number
  readonly y: number
  readonly text: string
  readonly size: number
  readonly color: string | undefined
  readonly bold: boolean
  readonly anchor: DrawTextAnchor
  /** Use the handwriting font stack instead of the UI font. */
  readonly hand: boolean
}

/** One strip of translucent washi tape, rotated slightly, for decoration. */
export interface DrawTapeElement {
  readonly type: 'tape'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: string | undefined
  readonly angle: number
}

/**
 * One compact pixel-art block: ASCII rows whose characters map to colors.
 *
 * A picture made of squares is the one drawing a language model authors
 * naturally -- far cheaper than hundreds of `shape` elements, and it replaces
 * the emoji-table that a chat model otherwise falls back to. A character the
 * palette does not name is transparent, so ragged rows need no padding.
 */
export interface DrawPixelElement {
  readonly type: 'pixels'
  readonly x: number
  readonly y: number
  /** Square edge length in canvas units. */
  readonly cell: number
  /** One string per row, top to bottom. */
  readonly rows: readonly string[]
  /** Character to color; a space is always transparent. */
  readonly palette: Readonly<Record<string, string>>
  /** How this block's ink combines with what is already painted; `normal` when unset. */
  readonly blend?: DrawBlend
}

/** Every element a drawing can hold. */
export type DrawElement = DrawPathElement | DrawShapeElement | DrawTextElement | DrawTapeElement | DrawPixelElement

/** Parsed {@link DRAW_KIND} payload: canvas, paper, and elements with defaults applied. */
export interface DrawPayload {
  readonly size: { readonly w: number; readonly h: number }
  readonly paper: DrawPaper
  /**
   * Canvas color painted under the paper rules and every element, or undefined
   * to let the card surface show through.
   *
   * The paper set has four *patterns*, not four colors, so before this field a
   * night sky, a cream page or a slate field could only be faked with a
   * full-canvas rect as element zero -- which then also wobbled, carried a
   * stroke, and counted against the element ceiling. A background is not an
   * element; it is the surface the ink sits on.
   */
  readonly background: string | undefined
  readonly rough: boolean
  readonly elements: readonly DrawElement[]
}

/**
 * One declarative card. The envelope is versioned and self-describing; the
 * payload is owned by the renderer registered for `kind`.
 */
export interface CardSpec {
  /** Envelope version, always {@link CARD_SPEC_VERSION} for this release. */
  readonly version: typeof CARD_SPEC_VERSION
  /** Renderer key. Unknown kinds are legal and render as a raw fallback. */
  readonly kind: string
  /** Optional human title the renderer may show; absent when the caller gave none. */
  readonly title?: string
  /** Kind-owned JSON object; never inspected by the envelope beyond its size. */
  readonly payload: Record<string, unknown>
}

/** Envelope validation outcome: the admitted spec, or the reason it was refused. */
export type CardValidation =
  | { readonly ok: true; readonly card: CardSpec }
  | { readonly ok: false; readonly error: string }

/** One table cell: the JSON scalars a table can hold. */
export type TableCell = string | number | boolean | null

/** Parsed {@link TABLE_KIND} payload: header cells plus rows no wider than the header. */
export interface TablePayload {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly TableCell[])[]
}

/**
 * A flowchart node's drawn shape -- the only styling the model chooses.
 * `terminal` starts or ends a flow, `decision` is a branch point, `process` is
 * an ordinary step.
 */
export type FlowchartShape = 'terminal' | 'process' | 'decision'

/** Every {@link FlowchartShape}, in the order the refusal message lists them. */
export const FLOWCHART_SHAPES: readonly FlowchartShape[] = ['terminal', 'process', 'decision']

/** One node of a {@link FLOWCHART_KIND} payload. */
export interface FlowchartNode {
  /** Stable id the connections reference; unique inside one payload. */
  readonly id: string
  /** The text drawn inside the shape. */
  readonly label: string
  /** Drawn shape; an omitted shape means `process`. */
  readonly shape: FlowchartShape
}

/** One directed connection between two declared nodes. */
export interface FlowchartEdge {
  /** Id of the node the connection leaves. */
  readonly from: string
  /** Id of the node the connection arrives at. */
  readonly to: string
  /** Optional text drawn beside the connection, such as a branch condition. */
  readonly label?: string
}

/** Parsed {@link FLOWCHART_KIND} payload: declared nodes plus their connections. */
export interface FlowchartPayload {
  readonly nodes: readonly FlowchartNode[]
  readonly edges: readonly FlowchartEdge[]
}

/** Narrow an unknown value to a non-array, non-null object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one unknown value to a {@link TableCell}. */
function isTableCell(value: unknown): value is TableCell {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}

/** Narrow one unknown value to a {@link FlowchartShape}. */
function isFlowchartShape(value: unknown): value is FlowchartShape {
  return typeof value === 'string' && (FLOWCHART_SHAPES as readonly string[]).includes(value)
}

/** Narrow one unknown value to a {@link DrawPen}. */
function isDrawPen(value: unknown): value is DrawPen {
  return typeof value === 'string' && (DRAW_PENS as readonly string[]).includes(value)
}

/** Whether a pen is one the engine paints as a stroke, so it can carry a dash. */
function isDrawStrokePen(pen: DrawPen): boolean {
  return (DRAW_STROKE_PENS as readonly string[]).includes(pen)
}

/** Narrow one unknown value to a {@link DrawPaper}. */
function isDrawPaper(value: unknown): value is DrawPaper {
  return typeof value === 'string' && (DRAW_PAPERS as readonly string[]).includes(value)
}

/** Narrow one unknown value to a {@link DrawDash}. */
function isDrawDash(value: unknown): value is DrawDash {
  return typeof value === 'string' && (DRAW_DASHES as readonly string[]).includes(value)
}

/** Narrow one unknown value to a {@link DrawShapeKind}. */
function isDrawShape(value: unknown): value is DrawShapeKind {
  return typeof value === 'string' && (DRAW_SHAPES as readonly string[]).includes(value)
}

/** Narrow one unknown value to a {@link DrawTextAnchor}. */
function isDrawAnchor(value: unknown): value is DrawTextAnchor {
  return typeof value === 'string' && (DRAW_ANCHORS as readonly string[]).includes(value)
}

/**
 * Validate the version-independent envelope every card shares.
 *
 * Deliberately silent about `kind`: an unknown kind is admitted here so a newer
 * producer keeps working against an older client, which is the whole point of
 * the raw fallback the view renders for it.
 * @param value - candidate spec, usually the Tool's raw arguments or a persisted projection value.
 * @returns the admitted spec carrying the current version, or the first refusal reason.
 */
export function readCardEnvelope(value: unknown): CardValidation {
  if (!isPlainObject(value)) return { ok: false, error: 'card must be an object with kind and payload' }

  const rawKind = value.kind
  if (typeof rawKind !== 'string') return { ok: false, error: 'kind must be a string' }
  const kind = rawKind.trim()
  if (kind.length === 0 || kind.length > MAX_KIND_LENGTH) {
    return { ok: false, error: `kind must be 1..${MAX_KIND_LENGTH} characters` }
  }
  if (!CARD_KIND_PATTERN.test(kind)) {
    return { ok: false, error: 'kind must start with a letter and contain only letters, digits, ".", "_" or "-"' }
  }

  let title: string | undefined
  const rawTitle = value.title
  if (rawTitle !== undefined && rawTitle !== null) {
    if (typeof rawTitle !== 'string') return { ok: false, error: 'title must be a string when present' }
    const trimmed = rawTitle.trim()
    if (trimmed.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `title must be at most ${MAX_TITLE_LENGTH} characters` }
    }
    if (trimmed.length > 0) title = trimmed
  }

  const payload = value.payload
  if (!isPlainObject(payload)) return { ok: false, error: 'payload must be a JSON object' }
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(payload)
  } catch {
    return { ok: false, error: 'payload must be JSON-serializable' }
  }
  if (serialized === undefined) return { ok: false, error: 'payload must be JSON-serializable' }
  if (serialized.length > MAX_PAYLOAD_LENGTH) {
    return { ok: false, error: `payload must serialize to at most ${MAX_PAYLOAD_LENGTH} characters` }
  }

  return {
    ok: true,
    card: {
      version: CARD_SPEC_VERSION,
      kind,
      ...title === undefined ? {} : { title },
      payload,
    },
  }
}

/**
 * Lenient admission used by the browser projection, which must render something
 * for every persisted call and therefore reports failure as `null`.
 * @param value - candidate spec from persisted Tool arguments.
 * @returns the spec, or null when the envelope is unusable.
 */
export function parseCardSpec(value: unknown): CardSpec | null {
  const result = readCardEnvelope(value)
  return result.ok ? result.card : null
}

/**
 * Parse a {@link TABLE_KIND} payload.
 * @param payload - candidate payload.
 * @returns the parsed table, or null when the payload is not a table.
 */
export function parseTablePayload(payload: unknown): TablePayload | null {
  const checked = checkTablePayload(payload)
  return checked.ok ? checked.table : null
}

/**
 * Check a {@link TABLE_KIND} payload with a reason, so the Host tool can refuse
 * a malformed table while it can still be corrected.
 * @param payload - candidate payload.
 * @returns the parsed table or the first refusal reason.
 */
function checkTablePayload(payload: unknown): { readonly ok: true; readonly table: TablePayload } | { readonly ok: false; readonly error: string } {
  if (!isPlainObject(payload)) return { ok: false, error: 'table payload must be a JSON object' }

  const columns = payload.columns
  if (!Array.isArray(columns)) return { ok: false, error: 'table payload needs a columns array' }
  if (columns.length === 0 || columns.length > MAX_TABLE_COLUMNS) {
    return { ok: false, error: `table payload needs 1..${MAX_TABLE_COLUMNS} columns` }
  }
  const headings: string[] = []
  for (const column of columns) {
    if (typeof column !== 'string' || column.trim().length === 0) {
      return { ok: false, error: 'every column must be a non-empty string' }
    }
    headings.push(column)
  }

  const rawRows = payload.rows ?? []
  if (!Array.isArray(rawRows)) return { ok: false, error: 'table payload rows must be an array' }
  if (rawRows.length > MAX_TABLE_ROWS) {
    return { ok: false, error: `table payload holds at most ${MAX_TABLE_ROWS} rows` }
  }
  const rows: TableCell[][] = []
  for (const row of rawRows) {
    if (!Array.isArray(row)) return { ok: false, error: 'every row must be an array of cells' }
    if (row.length > headings.length) {
      return { ok: false, error: `every row holds at most ${headings.length} cells, one per column` }
    }
    for (const cell of row) {
      if (!isTableCell(cell)) {
        return { ok: false, error: 'every cell must be a string, number, boolean or null' }
      }
    }
    rows.push(row as TableCell[])
  }

  return { ok: true, table: { columns: headings, rows } }
}

/**
 * Parse a {@link FLOWCHART_KIND} payload.
 * @param payload - candidate payload.
 * @returns the parsed diagram, or null when the payload is not one.
 */
export function parseFlowchartPayload(payload: unknown): FlowchartPayload | null {
  const checked = checkFlowchartPayload(payload)
  return checked.ok ? checked.flowchart : null
}

/**
 * Check a {@link FLOWCHART_KIND} payload with a reason.
 *
 * The two rules that make the diagram drawable are enforced here rather than in
 * the renderer: ids are unique, and every connection names nodes that exist.
 * Refusing them at the Host means the model gets a correctable error instead of
 * a card that silently drops an edge.
 * @param payload - candidate payload.
 * @returns the parsed diagram or the first refusal reason.
 */
function checkFlowchartPayload(
  payload: unknown,
): { readonly ok: true; readonly flowchart: FlowchartPayload } | { readonly ok: false; readonly error: string } {
  if (!isPlainObject(payload)) return { ok: false, error: 'flowchart payload must be a JSON object' }

  const rawNodes = payload.nodes
  if (!Array.isArray(rawNodes)) return { ok: false, error: 'flowchart payload needs a nodes array' }
  if (rawNodes.length === 0 || rawNodes.length > MAX_FLOWCHART_NODES) {
    return { ok: false, error: `flowchart payload needs 1..${MAX_FLOWCHART_NODES} nodes` }
  }

  const nodes: FlowchartNode[] = []
  const ids = new Set<string>()
  for (const rawNode of rawNodes) {
    if (!isPlainObject(rawNode)) return { ok: false, error: 'every node must be an object with an id and a label' }

    const id = rawNode.id
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > MAX_FLOWCHART_ID_LENGTH) {
      return { ok: false, error: `every node id must be a non-empty string of at most ${MAX_FLOWCHART_ID_LENGTH} characters` }
    }
    if (ids.has(id)) return { ok: false, error: `node id "${id}" is declared twice` }
    ids.add(id)

    const label = rawNode.label
    if (typeof label !== 'string' || label.trim().length === 0) {
      return { ok: false, error: 'every node needs a non-empty label' }
    }
    if (label.length > MAX_FLOWCHART_LABEL_LENGTH) {
      return { ok: false, error: `every node label must be at most ${MAX_FLOWCHART_LABEL_LENGTH} characters` }
    }

    let shape: FlowchartShape = 'process'
    const rawShape = rawNode.shape
    if (rawShape !== undefined && rawShape !== null) {
      if (!isFlowchartShape(rawShape)) {
        return { ok: false, error: `every node shape must be one of: ${FLOWCHART_SHAPES.join(', ')}` }
      }
      shape = rawShape
    }
    nodes.push({ id, label, shape })
  }

  const rawEdges = payload.edges ?? []
  if (!Array.isArray(rawEdges)) return { ok: false, error: 'flowchart payload edges must be an array' }
  if (rawEdges.length > MAX_FLOWCHART_EDGES) {
    return { ok: false, error: `flowchart payload holds at most ${MAX_FLOWCHART_EDGES} connections` }
  }

  const edges: FlowchartEdge[] = []
  for (const rawEdge of rawEdges) {
    if (!isPlainObject(rawEdge)) return { ok: false, error: 'every connection must be an object with from and to' }
    const { from, to } = rawEdge
    if (typeof from !== 'string' || typeof to !== 'string') {
      return { ok: false, error: 'every connection needs string from and to ids' }
    }
    if (!ids.has(from) || !ids.has(to)) {
      return { ok: false, error: `connection "${from}" -> "${to}" names a node that was not declared` }
    }
    if (from === to) {
      return { ok: false, error: `connection "${from}" -> "${to}" points at its own node` }
    }
    const rawLabel = rawEdge.label
    if (rawLabel !== undefined && rawLabel !== null) {
      if (typeof rawLabel !== 'string') return { ok: false, error: 'a connection label must be a string when present' }
      if (rawLabel.length > MAX_FLOWCHART_LABEL_LENGTH) {
        return { ok: false, error: `every connection label must be at most ${MAX_FLOWCHART_LABEL_LENGTH} characters` }
      }
      edges.push(rawLabel.length === 0 ? { from, to } : { from, to, label: rawLabel })
      continue
    }
    edges.push({ from, to })
  }

  return { ok: true, flowchart: { nodes, edges } }
}

/** Every letter that may start a path command, upper and lower case. */
const PATH_COMMAND_LETTERS = 'MLHVCQSTAZmlhvcqstaz'

/** One number token: optional sign, then an integer or decimal fraction. No exponent -- see {@link parseDrawPathData}. */
const PATH_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)/

/**
 * A path `d` string, normalized to the commands the drawing engine needs.
 *
 * `H`/`V` become `L`, `S`/`T` are reflected into `C`, `Q` is elevated to the
 * exact equivalent cubic, relative commands become absolute, and implicit
 * coordinate groups after `M`/`L` are expanded. Arcs keep their flags because
 * their geometry is only decided while flattening.
 */
export type DrawPathCommand =
  | { readonly cmd: 'M'; readonly x: number; readonly y: number }
  | { readonly cmd: 'L'; readonly x: number; readonly y: number }
  | { readonly cmd: 'C'; readonly c1x: number; readonly c1y: number; readonly c2x: number; readonly c2y: number; readonly x: number; readonly y: number }
  | { readonly cmd: 'A'; readonly rx: number; readonly ry: number; readonly rotation: number; readonly large: boolean; readonly sweep: boolean; readonly x: number; readonly y: number }
  | { readonly cmd: 'Z' }

/** Parse result: the normalized commands, or the first refusal reason. */
export type DrawPathParse =
  | { readonly ok: true; readonly commands: readonly DrawPathCommand[] }
  | { readonly ok: false; readonly error: string }

/**
 * Parse one path `d` string into absolute, normalized commands.
 *
 * The grammar is the SVG path mini-grammar minus what the engine does not
 * need. Two deliberate restrictions keep it safe and the errors readable:
 * numbers may not use exponent notation (their `e` would read as a command
 * letter, and the error says so), and the string must start with `M`/`m` and
 * contain at least one drawing command. Arc flags are read as single digits,
 * so `A5 5 0 0110 10` parses exactly like its spaced form. Nothing here
 * evaluates anything; the browser half flattens these commands into geometry.
 * @param d - the element's `d` string.
 * @returns the normalized commands, or the first syntax error with its position.
 */
export function parseDrawPathData(d: string): DrawPathParse {
  const commands: DrawPathCommand[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let moved = false
  let drew = false
  let cubicReflect: { x: number; y: number } | null = null
  let quadReflect: { x: number; y: number } | null = null
  let i = 0

  const isSeparator = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ','
  const atCommand = (): boolean => i < d.length && PATH_COMMAND_LETTERS.includes(d.charAt(i))

  /** Read one number at the cursor, or null when the next token is not one. */
  const readNumber = (): number | null => {
    while (i < d.length && isSeparator(d.charAt(i))) i += 1
    if (i >= d.length) return null
    const match = PATH_NUMBER.exec(d.slice(i))
    if (match === null) return null
    i += match[0].length
    return Number(match[0])
  }

  /** Read one arc flag digit, or null when the next token is not `0` or `1`. */
  const readFlag = (): 0 | 1 | null => {
    while (i < d.length && isSeparator(d.charAt(i))) i += 1
    if (i >= d.length) return null
    const ch = d.charAt(i)
    if (ch !== '0' && ch !== '1') return null
    i += 1
    return ch === '1' ? 1 : 0
  }

  /** Collect every number until the next command letter or the end of the string. */
  const readNumbers = (): { readonly values: number[] } | { readonly error: string } => {
    const values: number[] = []
    for (;;) {
      while (i < d.length && isSeparator(d.charAt(i))) i += 1
      if (i >= d.length || atCommand()) return { values }
      const match = PATH_NUMBER.exec(d.slice(i))
      if (match === null) return { error: `unexpected character "${d.charAt(i)}" at position ${i}` }
      values.push(Number(match[0]))
      i += match[0].length
    }
  }

  /** Absolute point of one coordinate pair for the current command's case. */
  const abs = (vx: number, vy: number, isRelative: boolean): { x: number; y: number } =>
    isRelative ? { x: cx + vx, y: cy + vy } : { x: vx, y: vy }

  while (i < d.length) {
    while (i < d.length && isSeparator(d.charAt(i))) i += 1
    if (i >= d.length) break
    const letter = d.charAt(i)
    if (!PATH_COMMAND_LETTERS.includes(letter)) {
      return {
        ok: false,
        error: `"${letter}" at position ${i} is not a path command (allowed: M L H V C S Q T A Z; numbers cannot use exponent notation)`,
      }
    }
    const position = i
    const upper = letter.toUpperCase()
    const relative = letter !== upper
    i += 1

    if (!moved && upper !== 'M') {
      return { ok: false, error: `path must start with M or m (found "${letter}" at position ${position})` }
    }

    if (upper === 'Z') {
      while (i < d.length && isSeparator(d.charAt(i))) i += 1
      if (i < d.length && !atCommand()) {
        return { ok: false, error: `Z at position ${position} takes no arguments` }
      }
      commands.push({ cmd: 'Z' })
      cx = sx
      cy = sy
      drew = true
      cubicReflect = null
      quadReflect = null
      continue
    }

    if (upper === 'M' || upper === 'L' || upper === 'T') {
      const read = readNumbers()
      if ('error' in read) return { ok: false, error: read.error }
      if (read.values.length === 0 || read.values.length % 2 !== 0) {
        return { ok: false, error: `"${letter}" at position ${position} needs pairs of coordinates` }
      }
      for (let k = 0; k < read.values.length; k += 2) {
        const end = abs(read.values[k]!, read.values[k + 1]!, relative)
        if (upper === 'M' && k === 0) {
          commands.push({ cmd: 'M', x: end.x, y: end.y })
          moved = true
          sx = end.x
          sy = end.y
        } else if (upper === 'T') {
          const prev: { x: number; y: number } = quadReflect ?? { x: cx, y: cy }
          const control: { x: number; y: number } = { x: 2 * cx - prev.x, y: 2 * cy - prev.y }
          commands.push({
            cmd: 'C',
            c1x: cx + (2 / 3) * (control.x - cx),
            c1y: cy + (2 / 3) * (control.y - cy),
            c2x: end.x + (2 / 3) * (control.x - end.x),
            c2y: end.y + (2 / 3) * (control.y - end.y),
            x: end.x,
            y: end.y,
          })
          quadReflect = control
          drew = true
        } else {
          commands.push({ cmd: 'L', x: end.x, y: end.y })
          drew = true
        }
        cx = end.x
        cy = end.y
      }
      if (upper !== 'T') {
        cubicReflect = null
        quadReflect = null
      } else {
        cubicReflect = null
      }
      continue
    }

    if (upper === 'H' || upper === 'V') {
      const read = readNumbers()
      if ('error' in read) return { ok: false, error: read.error }
      if (read.values.length === 0) {
        return { ok: false, error: `"${letter}" at position ${position} needs at least one coordinate` }
      }
      for (const value of read.values) {
        const end = upper === 'H' ? abs(value, 0, relative) : abs(0, value, relative)
        commands.push({ cmd: 'L', x: upper === 'H' ? end.x : cx, y: upper === 'H' ? cy : end.y })
        cx = upper === 'H' ? end.x : cx
        cy = upper === 'H' ? cy : end.y
        drew = true
      }
      cubicReflect = null
      quadReflect = null
      continue
    }

    if (upper === 'C' || upper === 'S' || upper === 'Q') {
      const arity = upper === 'C' ? 6 : 4
      const read = readNumbers()
      if ('error' in read) return { ok: false, error: read.error }
      if (read.values.length === 0 || read.values.length % arity !== 0) {
        return {
          ok: false,
          error: `"${letter}" at position ${position} needs ${arity === 6 ? 'six' : 'four'} numbers per segment`,
        }
      }
      for (let k = 0; k < read.values.length; k += arity) {
        const v = read.values
        if (upper === 'C') {
          const c1 = abs(v[k]!, v[k + 1]!, relative)
          const c2 = abs(v[k + 2]!, v[k + 3]!, relative)
          const end = abs(v[k + 4]!, v[k + 5]!, relative)
          commands.push({ cmd: 'C', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: end.x, y: end.y })
          cubicReflect = c2
        } else if (upper === 'S') {
          const prev = cubicReflect ?? { x: cx, y: cy }
          const c1 = { x: 2 * cx - prev.x, y: 2 * cy - prev.y }
          const c2 = abs(v[k]!, v[k + 1]!, relative)
          const end = abs(v[k + 2]!, v[k + 3]!, relative)
          commands.push({ cmd: 'C', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: end.x, y: end.y })
          cubicReflect = c2
        } else {
          const control = abs(v[k]!, v[k + 1]!, relative)
          const end = abs(v[k + 2]!, v[k + 3]!, relative)
          commands.push({
            cmd: 'C',
            c1x: cx + (2 / 3) * (control.x - cx),
            c1y: cy + (2 / 3) * (control.y - cy),
            c2x: end.x + (2 / 3) * (control.x - end.x),
            c2y: end.y + (2 / 3) * (control.y - end.y),
            x: end.x,
            y: end.y,
          })
          quadReflect = control
        }
        const end = commands[commands.length - 1]!
        if (end.cmd === 'C') {
          cx = end.x
          cy = end.y
        }
        drew = true
      }
      if (upper === 'C' || upper === 'S') quadReflect = null
      if (upper === 'Q') cubicReflect = null
      continue
    }

    // The only remaining command letter is A.
    let arcs = 0
    for (;;) {
      while (i < d.length && isSeparator(d.charAt(i))) i += 1
      if (i >= d.length || atCommand()) break
      const rx = readNumber()
      const ry = rx === null ? null : readNumber()
      const rotation = ry === null ? null : readNumber()
      const large = rotation === null ? null : readFlag()
      const sweep = large === null ? null : readFlag()
      const x = sweep === null ? null : readNumber()
      const y = x === null ? null : readNumber()
      if (y === null) {
        return { ok: false, error: `"${letter}" at position ${position} needs 7 arguments per arc (rx ry rotation large-arc sweep x y)` }
      }
      if (rx! < 0 || ry! < 0) {
        return { ok: false, error: `arc radii at position ${position} must be zero or positive` }
      }
      const end = abs(x!, y!, relative)
      commands.push({ cmd: 'A', rx: rx!, ry: ry!, rotation: rotation!, large: large === 1, sweep: sweep === 1, x: end.x, y: end.y })
      cx = end.x
      cy = end.y
      cubicReflect = null
      quadReflect = null
      drew = true
      arcs += 1
    }
    if (arcs === 0) {
      return { ok: false, error: `"${letter}" at position ${position} needs 7 arguments per arc (rx ry rotation large-arc sweep x y)` }
    }
  }

  if (!moved) return { ok: false, error: 'path must start with M or m' }
  if (!drew) return { ok: false, error: 'path needs at least one drawing command (L, H, V, C, S, Q, T, A or Z) after M' }
  return { ok: true, commands }
}

/** Hex color forms a draw color field accepts. */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Outcome of one color field check: admitted (possibly undefined), or the reason. */
type DrawColorCheck =
  | { readonly ok: true; readonly color: string | undefined }
  | { readonly ok: false; readonly error: string }

/**
 * Check one color field: absent (theme ink), a palette name, or `#rgb`/`#rrggbb`.
 * @param value - the raw field value.
 * @param at - element prefix for the refusal message, such as `element 3`.
 * @param field - field name for the refusal message.
 */
function checkDrawColor(value: unknown, at: string, field: string): DrawColorCheck {
  if (value === undefined || value === null) return { ok: true, color: undefined }
  if (typeof value !== 'string') return { ok: false, error: `${at}: ${field} must be a color name or #rrggbb` }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: true, color: undefined }
  if (HEX_COLOR_PATTERN.test(trimmed)) return { ok: true, color: trimmed }
  if (Object.prototype.hasOwnProperty.call(DRAW_COLORS, trimmed)) return { ok: true, color: trimmed }
  return {
    ok: false,
    error: `${at}: ${field} must be one of the named colors (${Object.keys(DRAW_COLORS).join(', ')}) or #rgb/#rrggbb`,
  }
}

/**
 * Check one element's blur spread, in canvas units; absent means a crisp edge.
 * @param value - the raw field value.
 * @param at - element prefix for the refusal message.
 * @param field - field name for the refusal message.
 */
function checkDrawBlur(value: unknown, at: string, field: string): { readonly ok: true; readonly blur: number | undefined } | { readonly ok: false; readonly error: string } {
  if (value === undefined || value === null) return { ok: true, blur: undefined }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${at}: ${field} must be a number between 0 and ${MAX_DRAW_BLUR}` }
  }
  if (value < 0 || value > MAX_DRAW_BLUR) {
    return { ok: false, error: `${at}: ${field} must be between 0 and ${MAX_DRAW_BLUR}` }
  }
  return { ok: true, blur: value > 0 ? value : undefined }
}

/**
 * Check one element's blend mode, defaulting to `normal`.
 * @param value - the raw field value.
 * @param at - element prefix for the refusal message.
 * @param field - field name for the refusal message.
 */
function checkDrawBlend(value: unknown, at: string, field: string): { readonly ok: true; readonly blend: DrawBlend } | { readonly ok: false; readonly error: string } {
  if (value === undefined || value === null) return { ok: true, blend: 'normal' }
  if (typeof value !== 'string' || !(DRAW_BLENDS as readonly string[]).includes(value)) {
    return { ok: false, error: `${at}: ${field} must be one of: ${DRAW_BLENDS.join(', ')}` }
  }
  return { ok: true, blend: value as DrawBlend }
}

/**
 * Check one bounded numeric field: absent means the fallback.
 * @param value - the raw field value.
 * @param at - element prefix for the refusal message.
 * @param field - field name for the refusal message.
 * @param min - smallest admitted value.
 * @param max - largest admitted value.
 * @param fallback - the value used when the field is absent.
 */
function checkNumber(
  value: unknown,
  at: string,
  field: string,
  min: number,
  max: number,
  fallback: number,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string } {
  if (value === undefined || value === null) return { ok: true, value: fallback }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${at}: ${field} must be a number between ${min} and ${max}` }
  }
  if (value < min || value > max) {
    return { ok: false, error: `${at}: ${field} must be between ${min} and ${max}` }
  }
  return { ok: true, value }
}

/**
 * Check one fill field: absent, `"none"`, a flat color, or a gradient.
 * @param value - the raw field value.
 * @param at - element prefix for the refusal message.
 * @param field - field name for the refusal message.
 */
function checkDrawFill(value: unknown, at: string, field: string): { readonly ok: true; readonly fill: DrawFill | undefined } | { readonly ok: false; readonly error: string } {
  if (value === undefined || value === null || value === 'none') return { ok: true, fill: undefined }
  if (typeof value === 'string') {
    if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/iu.test(value.trim())) {
      return {
        ok: false,
        error: `${at}: ${field} cannot be a CSS string. Send an object instead, e.g. `
          + '{"type":"linear","from":"#f5a15a","to":"#232a4d","angle":180} or '
          + '{"type":"radial","stops":[{"offset":0,"color":"#ffd27a"},{"offset":1,"color":"#ffd27a","opacity":0}]}',
      }
    }
    const color = checkDrawColor(value, at, field)
    return color.ok ? { ok: true, fill: color.color } : { ok: false, error: color.error }
  }
  const gradient = checkDrawGradient(value, at, field)
  return gradient.ok ? { ok: true, fill: gradient.gradient } : { ok: false, error: gradient.error }
}

/**
 * Check one gradient object and normalize it: stops sorted, opacity and angle defaulted.
 *
 * Stops carry their own alpha, which is what makes "warm haze fading into the
 * sky" or "a glow that dissolves into the background" a single element instead
 * of a stack of bands. Refusing at the Host keeps every refusal correctable.
 * @param value - the raw fill object.
 * @param at - element prefix for the refusal message.
 * @param field - field name for the refusal message.
 */
function checkDrawGradient(value: unknown, at: string, field: string): { readonly ok: true; readonly gradient: DrawGradient } | { readonly ok: false; readonly error: string } {
  if (!isPlainObject(value)) return { ok: false, error: `${at}: ${field} must be a color name, #rrggbb, or a gradient object` }
  const type = value.type
  if (typeof type !== 'string' || !(DRAW_GRADIENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `${at}: ${field}.type must be one of: ${DRAW_GRADIENT_TYPES.join(', ')}` }
  }
  const hasStops = value.stops !== undefined && value.stops !== null
  const hasEnds = value.from !== undefined || value.to !== undefined
  if (hasStops && hasEnds) {
    return { ok: false, error: `${at}: ${field} takes either stops or from/to, not both` }
  }
  let rawStops: unknown
  if (hasEnds) {
    if (value.from === undefined || value.from === null || value.to === undefined || value.to === null) {
      return { ok: false, error: `${at}: ${field} needs both from and to when using the shorthand` }
    }
    rawStops = [{ offset: 0, color: value.from }, { offset: 1, color: value.to }]
  } else {
    rawStops = value.stops
  }
  if (!Array.isArray(rawStops) || rawStops.length < 2 || rawStops.length > MAX_DRAW_GRADIENT_STOPS) {
    return { ok: false, error: `${at}: ${field} needs from/to or 2..${MAX_DRAW_GRADIENT_STOPS} stops` }
  }
  const stops: DrawGradientStop[] = []
  for (let index = 0; index < rawStops.length; index += 1) {
    const raw = rawStops[index]
    if (!isPlainObject(raw)) return { ok: false, error: `${at}: ${field}.stops[${index}] must be an object` }
    const offset = raw.offset
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0 || offset > 1) {
      return { ok: false, error: `${at}: ${field}.stops[${index}].offset must be a number between 0 and 1` }
    }
    const color = checkDrawColor(raw.color, at, `${field}.stops[${index}].color`)
    if (!color.ok) return { ok: false, error: color.error }
    if (color.color === undefined) {
      return { ok: false, error: `${at}: ${field}.stops[${index}].color is required` }
    }
    const opacity = checkDrawOpacity(raw.opacity, at, `${field}.stops[${index}].opacity`)
    if (!opacity.ok) return { ok: false, error: opacity.error }
    stops.push({ offset, color: color.color, opacity: opacity.opacity ?? 1 })
  }
  stops.sort((left, right) => left.offset - right.offset)

  let angle = 180
  if (value.angle !== undefined && value.angle !== null) {
    if (typeof value.angle !== 'number' || !Number.isFinite(value.angle)) {
      return { ok: false, error: `${at}: ${field}.angle must be a number of degrees` }
    }
    angle = ((value.angle % 360) + 360) % 360
  }
  if (type === 'radial' && value.angle !== undefined && value.angle !== null) {
    return { ok: false, error: `${at}: ${field}.angle only applies to a linear gradient; a radial gradient uses center and radius` }
  }

  let center: { readonly x: number; readonly y: number } | undefined
  if (value.center !== undefined && value.center !== null) {
    if (type !== 'radial') {
      return { ok: false, error: `${at}: ${field}.center only applies to a radial gradient` }
    }
    const rawCenter = value.center
    if (!isPlainObject(rawCenter)) return { ok: false, error: `${at}: ${field}.center must be an object like { x, y }` }
    const coords: number[] = []
    for (const axis of ['x', 'y'] as const) {
      const value2 = rawCenter[axis]
      if (typeof value2 !== 'number' || !Number.isFinite(value2) || Math.abs(value2) > MAX_DRAW_COORD) {
        return { ok: false, error: `${at}: ${field}.center.${axis} must be a finite number of magnitude at most ${MAX_DRAW_COORD}` }
      }
      coords.push(value2)
    }
    center = { x: coords[0]!, y: coords[1]! }
  }

  let radius: number | undefined
  if (value.radius !== undefined && value.radius !== null) {
    if (type !== 'radial') {
      return { ok: false, error: `${at}: ${field}.radius only applies to a radial gradient` }
    }
    const checked = checkNumber(value.radius, at, `${field}.radius`, 0.01, MAX_DRAW_COORD, 1)
    if (!checked.ok) return { ok: false, error: checked.error }
    radius = checked.value
  }

  return { ok: true, gradient: { type: type as DrawGradientType, stops, angle, center, radius } }
}

/**
 * Resolve a validated color to a paint value the browser can apply: theme ink
 * for undefined, the palette hex for a name, and the hex as given.
 * @param color - a color that passed {@link checkDrawColor}.
 * @returns the CSS paint value.
 */
export function resolveDrawColor(color: string | undefined): string {
  if (color === undefined) return 'var(--dsw-alias-text-primary, #1f1f1f)'
  const named: string | undefined = (DRAW_COLORS as Record<string, string | undefined>)[color]
  return named ?? color
}

/** Outcome of one opacity field check: admitted (possibly undefined), or the reason. */
type DrawOpacityCheck =
  | { readonly ok: true; readonly opacity: number | undefined }
  | { readonly ok: false; readonly error: string }

/**
 * Check one 0..1 opacity field, which is absent when omitted or blank.
 * @param value - the raw field value.
 * @param at - element prefix for the refusal message.
 * @param field - field name for the refusal message.
 */
function checkDrawOpacity(value: unknown, at: string, field: string): DrawOpacityCheck {
  if (value === undefined || value === null) return { ok: true, opacity: undefined }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return { ok: false, error: `${at}: ${field} must be a number between 0 and 1` }
  }
  return { ok: true, opacity: value }
}

/**
 * Check a {@link DRAW_KIND} payload with a reason.
 *
 * The rules that make the sketch drawable are enforced here rather than in the
 * renderer: every element is a known type with finite in-range coordinates, and
 * every path parses under the grammar. Refusing at the Host means the model
 * gets a correctable error instead of a card that silently drops a stroke.
 * @param payload - candidate payload.
 * @returns the normalized drawing or the first refusal reason.
 */
function checkDrawPayload(
  payload: unknown,
): { readonly ok: true; readonly draw: DrawPayload } | { readonly ok: false; readonly error: string } {
  if (!isPlainObject(payload)) return { ok: false, error: 'draw payload must be a JSON object' }

  const rawElements = payload.elements
  if (!Array.isArray(rawElements)) return { ok: false, error: 'draw payload needs an elements array' }
  if (rawElements.length === 0 || rawElements.length > MAX_DRAW_ELEMENTS) {
    return { ok: false, error: `draw payload needs 1..${MAX_DRAW_ELEMENTS} elements` }
  }

  let sizeW = DEFAULT_DRAW_SIZE_W
  let sizeH = DEFAULT_DRAW_SIZE_H
  const rawSize = payload.size
  if (rawSize !== undefined && rawSize !== null) {
    if (!isPlainObject(rawSize)) return { ok: false, error: 'draw size must be an object like { w, h }' }
    if (rawSize.w !== undefined && rawSize.w !== null) {
      if (typeof rawSize.w !== 'number' || !Number.isFinite(rawSize.w)) {
        return { ok: false, error: `draw size w must be a number between ${MIN_DRAW_SIZE_W} and ${MAX_DRAW_SIZE_W}` }
      }
      if (rawSize.w < MIN_DRAW_SIZE_W || rawSize.w > MAX_DRAW_SIZE_W) {
        return { ok: false, error: `draw size w must be between ${MIN_DRAW_SIZE_W} and ${MAX_DRAW_SIZE_W}` }
      }
      sizeW = rawSize.w
    }
    if (rawSize.h !== undefined && rawSize.h !== null) {
      if (typeof rawSize.h !== 'number' || !Number.isFinite(rawSize.h)) {
        return { ok: false, error: `draw size h must be a number between ${MIN_DRAW_SIZE_H} and ${MAX_DRAW_SIZE_H}` }
      }
      if (rawSize.h < MIN_DRAW_SIZE_H || rawSize.h > MAX_DRAW_SIZE_H) {
        return { ok: false, error: `draw size h must be between ${MIN_DRAW_SIZE_H} and ${MAX_DRAW_SIZE_H}` }
      }
      sizeH = rawSize.h
    }
  }

  let paper: DrawPaper = 'plain'
  const rawPaper = payload.paper
  if (rawPaper !== undefined && rawPaper !== null) {
    if (!isDrawPaper(rawPaper)) {
      return { ok: false, error: `draw paper must be one of: ${DRAW_PAPERS.join(', ')}` }
    }
    paper = rawPaper
  }

  let background: string | undefined
  const rawBackground = payload.background
  if (rawBackground !== undefined && rawBackground !== null && rawBackground !== 'none') {
    const checked = checkDrawColor(rawBackground, 'draw', 'background')
    if (!checked.ok) return { ok: false, error: checked.error }
    background = checked.color
  }

  let rough = true
  const rawRough = payload.rough
  if (rawRough !== undefined && rawRough !== null) {
    if (typeof rawRough !== 'boolean') return { ok: false, error: 'draw rough must be a boolean' }
    rough = rawRough
  }

  const elements: DrawElement[] = []
  for (let index = 0; index < rawElements.length; index += 1) {
    const raw = rawElements[index]
    if (!isPlainObject(raw)) return { ok: false, error: `element ${index} must be an object` }
    const at = `element ${index}`

    if (raw.type === 'path') {
      const d = raw.d
      if (typeof d !== 'string' || d.trim().length === 0) {
        return { ok: false, error: `${at}: path needs a non-empty d string` }
      }
      if (d.length > MAX_DRAW_PATH_LENGTH) {
        return { ok: false, error: `${at}: path d must be at most ${MAX_DRAW_PATH_LENGTH} characters` }
      }
      const parsedPath = parseDrawPathData(d)
      if (!parsedPath.ok) return { ok: false, error: `${at}: path d is not drawable -- ${parsedPath.error}` }

      const pen = raw.pen === undefined || raw.pen === null ? 'ball' : raw.pen
      if (!isDrawPen(pen)) {
        return { ok: false, error: `${at}: pen must be one of: ${DRAW_PENS.join(', ')}` }
      }
      const width = checkNumber(raw.width, at, 'width', MIN_DRAW_WIDTH, MAX_DRAW_WIDTH, DEFAULT_DRAW_WIDTH)
      if (!width.ok) return { ok: false, error: width.error }
      const color = checkDrawColor(raw.color, at, 'color')
      if (!color.ok) return { ok: false, error: color.error }
      const pathFill = checkDrawFill(raw.fill, at, 'fill')
      if (!pathFill.ok) return { ok: false, error: pathFill.error }
      const pathFillOpacity = checkDrawOpacity(raw.fillOpacity, at, 'fillOpacity')
      if (!pathFillOpacity.ok) return { ok: false, error: pathFillOpacity.error }
      const pathStrokeOpacity = checkDrawOpacity(raw.strokeOpacity, at, 'strokeOpacity')
      if (!pathStrokeOpacity.ok) return { ok: false, error: pathStrokeOpacity.error }
      const pathBlend = checkDrawBlend(raw.blend, at, 'blend')
      if (!pathBlend.ok) return { ok: false, error: pathBlend.error }
      const pathBlur = checkDrawBlur(raw.blur, at, 'blur')
      if (!pathBlur.ok) return { ok: false, error: pathBlur.error }
      let pathDash: DrawDash = 'solid'
      if (raw.dash !== undefined && raw.dash !== null) {
        if (!isDrawDash(raw.dash)) {
          return { ok: false, error: `${at}: dash must be one of: ${DRAW_DASHES.join(', ')}` }
        }
        pathDash = raw.dash
        if (pathDash !== 'solid' && !isDrawStrokePen(pen)) {
          return {
            ok: false,
            error: `${at}: pen "${pen}" draws a variable-width filled outline, so a dash has nothing to dash; `
              + `use one of ${DRAW_STROKE_PENS.join(', ')} for a dashed stroke`,
          }
        }
      }
      elements.push({
        type: 'path', d, pen, color: color.color, width: width.value, dash: pathDash, blend: pathBlend.blend,
        ...pathFill.fill === undefined ? {} : { fill: pathFill.fill },
        ...pathFillOpacity.opacity === undefined ? {} : { fillOpacity: pathFillOpacity.opacity },
        ...pathStrokeOpacity.opacity === undefined ? {} : { strokeOpacity: pathStrokeOpacity.opacity },
        ...pathBlur.blur === undefined ? {} : { blur: pathBlur.blur },
      })
      continue
    }

    if (raw.type === 'shape') {
      const shape = raw.shape
      if (!isDrawShape(shape)) {
        return { ok: false, error: `${at}: shape must be one of: ${DRAW_SHAPES.join(', ')}` }
      }
      const coords: number[] = []
      for (const field of ['x', 'y', 'w', 'h'] as const) {
        const value = raw[field]
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_DRAW_COORD) {
          return { ok: false, error: `${at}: ${field} must be a finite number of magnitude at most ${MAX_DRAW_COORD}` }
        }
        coords.push(value)
      }
      const [x, y, w, h] = coords as [number, number, number, number]
      if (shape !== 'line' && shape !== 'arrow') {
        if (w < 0 || h < 0) {
          return { ok: false, error: `${at}: ${shape} needs w ≥ 0 and h ≥ 0 (x, y is the top-left corner)` }
        }
      } else if (w === 0 && h === 0) {
        return { ok: false, error: `${at}: ${shape} needs a direction (w and h cannot both be zero)` }
      }
      const width = checkNumber(raw.width, at, 'width', MIN_DRAW_WIDTH, MAX_DRAW_WIDTH, DEFAULT_DRAW_WIDTH)
      if (!width.ok) return { ok: false, error: width.error }
      const color = checkDrawColor(raw.color, at, 'color')
      if (!color.ok) return { ok: false, error: color.error }
      const shapeFill = checkDrawFill(raw.fill, at, 'fill')
      if (!shapeFill.ok) return { ok: false, error: shapeFill.error }
      let dash: DrawDash = 'solid'
      if (raw.dash !== undefined && raw.dash !== null) {
        if (!isDrawDash(raw.dash)) {
          return { ok: false, error: `${at}: dash must be one of: ${DRAW_DASHES.join(', ')}` }
        }
        dash = raw.dash
      }
      let arrowStart = false
      if (raw.arrowStart !== undefined && raw.arrowStart !== null) {
        if (typeof raw.arrowStart !== 'boolean') return { ok: false, error: `${at}: arrowStart must be a boolean` }
        arrowStart = raw.arrowStart
      }
      let roughElement = rough
      if (raw.rough !== undefined && raw.rough !== null) {
        if (typeof raw.rough !== 'boolean') return { ok: false, error: `${at}: rough must be a boolean` }
        roughElement = raw.rough
      }
      const shapeFillOpacity = checkDrawOpacity(raw.fillOpacity, at, 'fillOpacity')
      if (!shapeFillOpacity.ok) return { ok: false, error: shapeFillOpacity.error }
      const shapeStrokeOpacity = checkDrawOpacity(raw.strokeOpacity, at, 'strokeOpacity')
      if (!shapeStrokeOpacity.ok) return { ok: false, error: shapeStrokeOpacity.error }
      const shapeBlend = checkDrawBlend(raw.blend, at, 'blend')
      if (!shapeBlend.ok) return { ok: false, error: shapeBlend.error }
      const shapeBlur = checkDrawBlur(raw.blur, at, 'blur')
      if (!shapeBlur.ok) return { ok: false, error: shapeBlur.error }
      elements.push({
        type: 'shape', shape, x, y, w, h,
        color: color.color, fill: shapeFill.fill, width: width.value, dash, arrowStart, rough: roughElement,
        blend: shapeBlend.blend,
        ...shapeFillOpacity.opacity === undefined ? {} : { fillOpacity: shapeFillOpacity.opacity },
        ...shapeStrokeOpacity.opacity === undefined ? {} : { strokeOpacity: shapeStrokeOpacity.opacity },
        ...shapeBlur.blur === undefined ? {} : { blur: shapeBlur.blur },
      })
      continue
    }

    if (raw.type === 'text') {
      const text = raw.text
      if (typeof text !== 'string' || text.trim().length === 0) {
        return { ok: false, error: `${at}: text needs a non-empty string` }
      }
      if (text.length > MAX_DRAW_TEXT_LENGTH) {
        return { ok: false, error: `${at}: text must be at most ${MAX_DRAW_TEXT_LENGTH} characters` }
      }
      const coords: number[] = []
      for (const field of ['x', 'y'] as const) {
        const value = raw[field]
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_DRAW_COORD) {
          return { ok: false, error: `${at}: ${field} must be a finite number of magnitude at most ${MAX_DRAW_COORD}` }
        }
        coords.push(value)
      }
      const size = checkNumber(raw.size, at, 'size', MIN_DRAW_TEXT_SIZE, MAX_DRAW_TEXT_SIZE, DEFAULT_DRAW_TEXT_SIZE)
      if (!size.ok) return { ok: false, error: size.error }
      const color = checkDrawColor(raw.color, at, 'color')
      if (!color.ok) return { ok: false, error: color.error }
      let anchor: DrawTextAnchor = 'start'
      if (raw.anchor !== undefined && raw.anchor !== null) {
        if (!isDrawAnchor(raw.anchor)) {
          return { ok: false, error: `${at}: anchor must be one of: ${DRAW_ANCHORS.join(', ')}` }
        }
        anchor = raw.anchor
      }
      let bold = false
      if (raw.bold !== undefined && raw.bold !== null) {
        if (typeof raw.bold !== 'boolean') return { ok: false, error: `${at}: bold must be a boolean` }
        bold = raw.bold
      }
      let hand = false
      if (raw.hand !== undefined && raw.hand !== null) {
        if (typeof raw.hand !== 'boolean') return { ok: false, error: `${at}: hand must be a boolean` }
        hand = raw.hand
      }
      elements.push({ type: 'text', x: coords[0]!, y: coords[1]!, text, size: size.value, color: color.color, bold, anchor, hand })
      continue
    }

    if (raw.type === 'tape') {
      const w = checkNumber(raw.w, at, 'w', MIN_DRAW_TAPE_W, MAX_DRAW_TAPE_W, 0)
      if (!w.ok || w.value === 0) {
        return { ok: false, error: `${at}: tape w must be between ${MIN_DRAW_TAPE_W} and ${MAX_DRAW_TAPE_W}` }
      }
      const coords: number[] = []
      for (const field of ['x', 'y'] as const) {
        const value = raw[field]
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_DRAW_COORD) {
          return { ok: false, error: `${at}: ${field} must be a finite number of magnitude at most ${MAX_DRAW_COORD}` }
        }
        coords.push(value)
      }
      const h = checkNumber(raw.h, at, 'h', MIN_DRAW_TAPE_H, MAX_DRAW_TAPE_H, DEFAULT_DRAW_TAPE_H)
      if (!h.ok) return { ok: false, error: h.error }
      const angle = checkNumber(raw.angle, at, 'angle', MIN_DRAW_TAPE_ANGLE, MAX_DRAW_TAPE_ANGLE, DEFAULT_DRAW_TAPE_ANGLE)
      if (!angle.ok) return { ok: false, error: angle.error }
      const color = checkDrawColor(raw.color, at, 'color')
      if (!color.ok) return { ok: false, error: color.error }
      elements.push({ type: 'tape', x: coords[0]!, y: coords[1]!, w: w.value, h: h.value, color: color.color, angle: angle.value })
      continue
    }

    if (raw.type === 'pixels') {
      const coords: number[] = []
      for (const field of ['x', 'y'] as const) {
        const value = raw[field]
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_DRAW_COORD) {
          return { ok: false, error: `${at}: ${field} must be a finite number of magnitude at most ${MAX_DRAW_COORD}` }
        }
        coords.push(value)
      }
      const cell = checkNumber(raw.cell, at, 'cell', MIN_PIXEL_CELL, MAX_PIXEL_CELL, DEFAULT_PIXEL_CELL)
      if (!cell.ok) return { ok: false, error: cell.error }

      const rawRows = raw.rows
      if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > MAX_PIXEL_ROWS) {
        return { ok: false, error: `${at}: pixels needs 1..${MAX_PIXEL_ROWS} rows` }
      }
      const rows: string[] = []
      for (const row of rawRows) {
        if (typeof row !== 'string' || row.length === 0 || row.length > MAX_PIXEL_COLS) {
          return { ok: false, error: `${at}: every pixel row must be a non-empty string of at most ${MAX_PIXEL_COLS} characters` }
        }
        rows.push(row)
      }

      const rawPalette = raw.palette
      if (!isPlainObject(rawPalette)) {
        return { ok: false, error: `${at}: pixels needs a palette object mapping characters to colors` }
      }
      const paletteKeys = Object.keys(rawPalette)
      if (paletteKeys.length === 0 || paletteKeys.length > MAX_PIXEL_PALETTE) {
        return { ok: false, error: `${at}: palette needs 1..${MAX_PIXEL_PALETTE} entries` }
      }
      const palette: Record<string, string> = {}
      for (const key of paletteKeys) {
        if (key.length !== 1 || key === ' ') {
          return { ok: false, error: `${at}: palette keys must be single characters (a space is always transparent)` }
        }
        const checkedColor = checkDrawColor(rawPalette[key], at, `palette["${key}"]`)
        if (!checkedColor.ok) return { ok: false, error: checkedColor.error }
        if (checkedColor.color === undefined) {
          return { ok: false, error: `${at}: palette["${key}"] needs a color` }
        }
        palette[key] = checkedColor.color
      }

      let painted = 0
      for (const row of rows) {
        for (const character of row) {
          if (palette[character] !== undefined) painted += 1
        }
      }
      if (painted === 0) {
        return { ok: false, error: `${at}: no character in the rows matches the palette, so nothing would be drawn` }
      }
      if (painted > MAX_PIXEL_CELLS) {
        return { ok: false, error: `${at}: pixels paints ${painted} cells, above the ${MAX_PIXEL_CELLS} ceiling` }
      }
      const pixelsBlend = checkDrawBlend(raw.blend, at, 'blend')
      if (!pixelsBlend.ok) return { ok: false, error: pixelsBlend.error }
      elements.push({ type: 'pixels', x: coords[0]!, y: coords[1]!, cell: cell.value, rows, palette, blend: pixelsBlend.blend })
      continue
    }

    return { ok: false, error: `${at}: type must be one of: path, shape, text, tape, pixels` }
  }

  return { ok: true, draw: { size: { w: sizeW, h: sizeH }, paper, background, rough, elements } }
}

/**
 * Parse a {@link DRAW_KIND} payload.
 * @param payload - candidate payload.
 * @returns the normalized drawing, or null when the payload is not one.
 */
export function parseDrawPayload(payload: unknown): DrawPayload | null {
  const checked = checkDrawPayload(payload)
  return checked.ok ? checked.draw : null
}

/**
 * Validate the Tool's raw arguments: the shared envelope plus, for a
 * {@link TABLE_KIND} or {@link FLOWCHART_KIND} card, the payload shape itself.
 * An unknown kind is admitted by design -- forward compatibility is the client's
 * raw fallback, not a Host-side allowlist.
 * @param value - the model's Tool arguments.
 * @returns the admitted spec, or the reason the call must fail with.
 */
export function validateCardArgs(value: unknown): CardValidation {
  const result = readCardEnvelope(value)
  if (!result.ok) return result
  if (result.card.kind === TABLE_KIND) {
    const table = checkTablePayload(result.card.payload)
    if (!table.ok) return { ok: false, error: table.error }
  }
  if (result.card.kind === FLOWCHART_KIND) {
    const flowchart = checkFlowchartPayload(result.card.payload)
    if (!flowchart.ok) return { ok: false, error: flowchart.error }
  }
  if (result.card.kind === DRAW_KIND) {
    const draw = checkDrawPayload(result.card.payload)
    if (!draw.ok) return { ok: false, error: draw.error }
  }
  if (result.card.kind === FIGURE_KIND) {
    const figure = checkFigurePayload(result.card.payload)
    if (!figure.ok) return { ok: false, error: figure.error }
  }
  return result
}

/**
 * Describe a card in prose for the model.
 *
 * The card is the human's deliverable; this line is the model's -- so it states
 * the facts a follow-up turn needs (kind, title, and the payload's shape) and
 * nothing the picture already says.
 * @param card - the admitted spec.
 * @returns a short factual summary.
 */
export function summarizeCard(card: CardSpec): string {
  const title = card.title === undefined ? '' : ` titled "${card.title}"`
  if (card.kind === TABLE_KIND) {
    const table = parseTablePayload(card.payload)
    if (table !== null) {
      const shown = table.columns.slice(0, 6).join(', ')
      const more = table.columns.length > 6 ? ', ...' : ''
      return `Showed a "table" card${title}: columns ${shown}${more}; ${table.rows.length} row(s).`
    }
  }
  if (card.kind === FLOWCHART_KIND) {
    const flowchart = parseFlowchartPayload(card.payload)
    if (flowchart !== null) {
      return `Showed a "flowchart" card${title}: ${flowchart.nodes.length} node(s), ${flowchart.edges.length} connection(s).`
    }
  }
  if (card.kind === DRAW_KIND) {
    const draw = parseDrawPayload(card.payload)
    if (draw !== null) {
      return `Showed a "draw" card${title}: ${draw.elements.length} element(s) on ${draw.size.w}x${draw.size.h} ${draw.paper} paper.`
    }
  }
  if (card.kind === FIGURE_KIND) {
    const figure = parseFigurePayload(card.payload)
    if (figure !== null) {
      return `Showed a "figure" card${title}: ${summarizeFigure(figure)}.`
    }
  }
  const keys = Object.keys(card.payload)
  const shape = keys.length === 0 ? 'no payload keys' : `payload keys: ${keys.slice(0, 8).join(', ')}`
  return `Showed a "${card.kind}" card${title} (${shape}).`
}

/**
 * The `draw` geometry kernel.
 *
 * It lives here, not in the browser half, because both halves need the identical
 * answer: the browser paints it, and the Host rasterizes the very same ink so the
 * model can look at what it drew. One implementation is what makes the preview
 * an honest picture of the card instead of a second, drifting drawing.
 */
export * from './draw-engine.ts'

/**
 * The renderer-neutral display list and its standalone SVG serialization.
 *
 * The Host rasterizes this list into the preview image a model reads back, and
 * the same list is what the browser's ink corresponds to; exporting it from the
 * kernel is what keeps those two one picture.
 */
export * from './draw-render.ts'

/**
 * The self-check: what a model cannot see about the picture it just authored.
 *
 * Deliberately taste-free -- extents, coverage, balance, palette size and
 * palette-independent faults are geometry, and geometry is checkable.
 */
export * from './draw-diagnostics.ts'

/**
 * Semantic teaching-figure templates and validation. The figure renderer lives
 * in the client half; the model never supplies geometry.
 */
export * from './figure.ts'