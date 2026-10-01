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
  const keys = Object.keys(card.payload)
  const shape = keys.length === 0 ? 'no payload keys' : `payload keys: ${keys.slice(0, 8).join(', ')}`
  return `Showed a "${card.kind}" card${title} (${shape}).`
}