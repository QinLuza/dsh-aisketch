/**
 * The semantic teaching-figure card.
 *
 * Scientific diagrams fail differently from illustrations: the ink can look
 * pleasant while a normal force points the wrong way. The model therefore never
 * supplies coordinates here. It names a template and a few semantic parameters;
 * this module validates the parameters, and the renderer derives every angle,
 * anchor and label position from them.
 *
 * The first slice deliberately contains two templates and nothing generic:
 * `incline_force` for a block on an incline, and `atom_shell` for the first 20
 * neutral atoms. A new template is a new validator plus a new renderer, not a
 * general constraint engine.
 */

/** Native card kind for a teaching / scientific figure. */
export const FIGURE_KIND = 'figure'

/** Templates this release understands. */
export const FIGURE_TEMPLATES = ['incline_force', 'connected_bodies', 'orbital_diagram', 'atom_shell'] as const

/** A supported figure template. */
export type FigureTemplate = typeof FIGURE_TEMPLATES[number]

/** Incline angle bounds. Extremes are rejected because the drawing stops being readable. */
export const MIN_INCLINE_ANGLE = 5
export const MAX_INCLINE_ANGLE = 85

/** Mass bounds, in kilograms. */
export const MIN_INCLINE_MASS = 0.1
export const MAX_INCLINE_MASS = 100

/** Friction coefficient bounds. */
export const MIN_FRICTION_COEFF = 0
export const MAX_FRICTION_COEFF = 2

/** Gravity bounds, in m/s². */
export const MIN_GRAVITY = 1
export const MAX_GRAVITY = 30

/** Bounds for the table-pulley connected-body template. */
export const MIN_CONNECTED_MASS = 0.1
export const MAX_CONNECTED_MASS = 100
export const MIN_CONNECTED_FRICTION = 0
export const MAX_CONNECTED_FRICTION = 1.5

/** Electron configurations for the 2D orbital diagram, H through Zn. */
export const ORBITAL_CONFIGURATION_REFERENCE = [
  ['H', 1, '1s1'],
  ['He', 2, '1s2'],
  ['Li', 3, '1s2 2s1'],
  ['Be', 4, '1s2 2s2'],
  ['B', 5, '1s2 2s2 2p1'],
  ['C', 6, '1s2 2s2 2p2'],
  ['N', 7, '1s2 2s2 2p3'],
  ['O', 8, '1s2 2s2 2p4'],
  ['F', 9, '1s2 2s2 2p5'],
  ['Ne', 10, '1s2 2s2 2p6'],
  ['Na', 11, '1s2 2s2 2p6 3s1'],
  ['Mg', 12, '1s2 2s2 2p6 3s2'],
  ['Al', 13, '1s2 2s2 2p6 3s2 3p1'],
  ['Si', 14, '1s2 2s2 2p6 3s2 3p2'],
  ['P', 15, '1s2 2s2 2p6 3s2 3p3'],
  ['S', 16, '1s2 2s2 2p6 3s2 3p4'],
  ['Cl', 17, '1s2 2s2 2p6 3s2 3p5'],
  ['Ar', 18, '1s2 2s2 2p6 3s2 3p6'],
  ['K', 19, '1s2 2s2 2p6 3s2 3p6 4s1'],
  ['Ca', 20, '1s2 2s2 2p6 3s2 3p6 4s2'],
  ['Sc', 21, '1s2 2s2 2p6 3s2 3p6 3d1 4s2'],
  ['Ti', 22, '1s2 2s2 2p6 3s2 3p6 3d2 4s2'],
  ['V', 23, '1s2 2s2 2p6 3s2 3p6 3d3 4s2'],
  ['Cr', 24, '1s2 2s2 2p6 3s2 3p6 3d5 4s1'],
  ['Mn', 25, '1s2 2s2 2p6 3s2 3p6 3d5 4s2'],
  ['Fe', 26, '1s2 2s2 2p6 3s2 3p6 3d6 4s2'],
  ['Co', 27, '1s2 2s2 2p6 3s2 3p6 3d7 4s2'],
  ['Ni', 28, '1s2 2s2 2p6 3s2 3p6 3d8 4s2'],
  ['Cu', 29, '1s2 2s2 2p6 3s2 3p6 3d10 4s1'],
  ['Zn', 30, '1s2 2s2 2p6 3s2 3p6 3d10 4s2'],
] as const

/** One subshell's electron count in an orbital diagram. */
export interface OrbitalSubshell {
  readonly subshell: string
  readonly electrons: number
}

/** Normalized orbital-diagram parameters. */
export interface OrbitalDiagramParams {
  readonly symbol: string
  readonly atomicNumber: number
  readonly configuration: readonly OrbitalSubshell[]
}

/** Parsed orbital diagram. */
export interface OrbitalDiagramFigure {
  readonly template: 'orbital_diagram'
  readonly params: OrbitalDiagramParams
}

/** Look up an element and parse its subshell configuration. */
export function orbitalDiagramBySymbol(symbol: string): OrbitalDiagramParams | undefined {
  const normalized = symbol.trim()
  if (!/^[A-Za-z]{1,2}$/u.test(normalized)) return undefined
  const canonical = normalized[0]!.toUpperCase() + normalized.slice(1).toLowerCase()
  const entry = ORBITAL_CONFIGURATION_REFERENCE.find(row => row[0] === canonical)
  if (entry === undefined) return undefined
  const configuration = [...entry[2].matchAll(/([0-9]+[spdf])([0-9]+)/g)].map(match => ({
    subshell: match[1]!,
    electrons: Number(match[2]),
  }))
  return { symbol: entry[0], atomicNumber: entry[1], configuration }
}

/** The only atoms this first slice knows, with their ground-state shell counts. */
export const ATOM_SHELL_REFERENCE = [
  { symbol: 'H', atomicNumber: 1, shells: [1] },
  { symbol: 'He', atomicNumber: 2, shells: [2] },
  { symbol: 'Li', atomicNumber: 3, shells: [2, 1] },
  { symbol: 'Be', atomicNumber: 4, shells: [2, 2] },
  { symbol: 'B', atomicNumber: 5, shells: [2, 3] },
  { symbol: 'C', atomicNumber: 6, shells: [2, 4] },
  { symbol: 'N', atomicNumber: 7, shells: [2, 5] },
  { symbol: 'O', atomicNumber: 8, shells: [2, 6] },
  { symbol: 'F', atomicNumber: 9, shells: [2, 7] },
  { symbol: 'Ne', atomicNumber: 10, shells: [2, 8] },
  { symbol: 'Na', atomicNumber: 11, shells: [2, 8, 1] },
  { symbol: 'Mg', atomicNumber: 12, shells: [2, 8, 2] },
  { symbol: 'Al', atomicNumber: 13, shells: [2, 8, 3] },
  { symbol: 'Si', atomicNumber: 14, shells: [2, 8, 4] },
  { symbol: 'P', atomicNumber: 15, shells: [2, 8, 5] },
  { symbol: 'S', atomicNumber: 16, shells: [2, 8, 6] },
  { symbol: 'Cl', atomicNumber: 17, shells: [2, 8, 7] },
  { symbol: 'Ar', atomicNumber: 18, shells: [2, 8, 8] },
  { symbol: 'K', atomicNumber: 19, shells: [2, 8, 8, 1] },
  { symbol: 'Ca', atomicNumber: 20, shells: [2, 8, 8, 2] },
] as const

/** Normalized incline-force parameters used by the renderer. */
export interface InclineForceParams {
  readonly angleDeg: number
  readonly massKg: number
  readonly frictionCoeff: number
  readonly gravity: number
  readonly showComponents: boolean
  readonly showValues: boolean
}

/** Normalized table-pulley connected-body parameters. */
export interface ConnectedBodiesParams {
  readonly surfaceMassKg: number
  readonly hangingMassKg: number
  readonly frictionCoeff: number
  readonly gravity: number
  readonly showValues: boolean
}

/** Normalized atom-shell parameters; the shell counts come from the reference table. */
export interface AtomShellParams {
  readonly symbol: string
  readonly atomicNumber: number
  readonly shells: readonly number[]
  readonly showShellCounts: boolean
}

/** Parsed incline-force figure. */
export interface InclineForceFigure {
  readonly template: 'incline_force'
  readonly params: InclineForceParams
}

/** Parsed table-pulley connected-body figure. */
export interface ConnectedBodiesFigure {
  readonly template: 'connected_bodies'
  readonly params: ConnectedBodiesParams
}

/** Parsed atom-shell figure. */
export interface AtomShellFigure {
  readonly template: 'atom_shell'
  readonly params: AtomShellParams
}

/** A parsed teaching figure. */
export type FigurePayload = InclineForceFigure | ConnectedBodiesFigure | OrbitalDiagramFigure | AtomShellFigure

/** Validation result for a figure payload. */
export type FigureValidation =
  | { readonly ok: true; readonly figure: FigurePayload }
  | { readonly ok: false; readonly error: string }

/** Narrow one unknown value to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a number with bounds and a field-specific error. */
function numberField(
  value: unknown,
  at: string,
  field: string,
  min: number,
  max: number,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${at}: ${field} must be a finite number` }
  }
  if (value < min || value > max) {
    return { ok: false, error: `${at}: ${field} must be between ${min} and ${max}` }
  }
  return { ok: true, value }
}

/** Read an optional boolean. */
function booleanField(
  value: unknown,
  at: string,
  field: string,
  fallback: boolean,
): { readonly ok: true; readonly value: boolean } | { readonly ok: false; readonly error: string } {
  if (value === undefined || value === null) return { ok: true, value: fallback }
  if (typeof value !== 'boolean') return { ok: false, error: `${at}: ${field} must be a boolean` }
  return { ok: true, value }
}

/** Look up one atom in the reference table, case-insensitively. */
export function atomShellBySymbol(symbol: string): typeof ATOM_SHELL_REFERENCE[number] | undefined {
  const normalized = symbol.trim()
  if (!/^[A-Za-z]{1,2}$/u.test(normalized)) return undefined
  const canonical = normalized[0]!.toUpperCase() + normalized.slice(1).toLowerCase()
  return ATOM_SHELL_REFERENCE.find(entry => entry.symbol === canonical)
}

/**
 * Check a figure payload with a reason, so the Host can refuse a malformed
 * figure before it reaches the browser.
 * @param payload - candidate figure payload.
 * @returns normalized parameters, or the first correction the model can make.
 */
export function checkFigurePayload(payload: unknown): FigureValidation {
  if (!isRecord(payload)) return { ok: false, error: 'figure payload must be an object' }
  if (typeof payload.template !== 'string' || !(FIGURE_TEMPLATES as readonly string[]).includes(payload.template)) {
    return { ok: false, error: `figure template must be one of: ${FIGURE_TEMPLATES.join(', ')}` }
  }
  if (!isRecord(payload.params)) return { ok: false, error: 'figure params must be an object' }

  if (payload.template === 'orbital_diagram') {
    if (typeof payload.params.symbol !== 'string') return { ok: false, error: 'orbital_diagram: symbol must be a string' }
    const orbital = orbitalDiagramBySymbol(payload.params.symbol)
    if (orbital === undefined) return { ok: false, error: 'orbital_diagram: symbol must be one of the first 30 elements (H through Zn)' }
    return { ok: true, figure: { template: 'orbital_diagram', params: orbital } }
  }

  if (payload.template === 'connected_bodies') {
    const p = payload.params
    const surfaceMass = numberField(p.surfaceMassKg, 'connected_bodies', 'surfaceMassKg', MIN_CONNECTED_MASS, MAX_CONNECTED_MASS)
    if (!surfaceMass.ok) return surfaceMass
    const hangingMass = numberField(p.hangingMassKg, 'connected_bodies', 'hangingMassKg', MIN_CONNECTED_MASS, MAX_CONNECTED_MASS)
    if (!hangingMass.ok) return hangingMass
    const friction = numberField(p.frictionCoeff, 'connected_bodies', 'frictionCoeff', MIN_CONNECTED_FRICTION, MAX_CONNECTED_FRICTION)
    if (!friction.ok) return friction
    const gravity = numberField(p.gravity ?? 9.8, 'connected_bodies', 'gravity', MIN_GRAVITY, MAX_GRAVITY)
    if (!gravity.ok) return gravity
    const values = booleanField(p.showValues, 'connected_bodies', 'showValues', true)
    if (!values.ok) return values
    return {
      ok: true,
      figure: {
        template: 'connected_bodies',
        params: {
          surfaceMassKg: surfaceMass.value,
          hangingMassKg: hangingMass.value,
          frictionCoeff: friction.value,
          gravity: gravity.value,
          showValues: values.value,
        },
      },
    }
  }

  if (payload.template === 'incline_force') {
    const p = payload.params
    const angle = numberField(p.angleDeg, 'incline_force', 'angleDeg', MIN_INCLINE_ANGLE, MAX_INCLINE_ANGLE)
    if (!angle.ok) return angle
    const mass = numberField(p.massKg, 'incline_force', 'massKg', MIN_INCLINE_MASS, MAX_INCLINE_MASS)
    if (!mass.ok) return mass
    const friction = numberField(p.frictionCoeff, 'incline_force', 'frictionCoeff', MIN_FRICTION_COEFF, MAX_FRICTION_COEFF)
    if (!friction.ok) return friction
    const gravity = numberField(p.gravity ?? 9.8, 'incline_force', 'gravity', MIN_GRAVITY, MAX_GRAVITY)
    if (!gravity.ok) return gravity
    const components = booleanField(p.showComponents, 'incline_force', 'showComponents', false)
    if (!components.ok) return components
    const values = booleanField(p.showValues, 'incline_force', 'showValues', true)
    if (!values.ok) return values
    return {
      ok: true,
      figure: {
        template: 'incline_force',
        params: {
          angleDeg: angle.value,
          massKg: mass.value,
          frictionCoeff: friction.value,
          gravity: gravity.value,
          showComponents: components.value,
          showValues: values.value,
        },
      },
    }
  }

  const p = payload.params
  if (typeof p.symbol !== 'string') return { ok: false, error: 'atom_shell: symbol must be a string' }
  const entry = atomShellBySymbol(p.symbol)
  if (entry === undefined) {
    return {
      ok: false,
      error: 'atom_shell: symbol must be one of the first 20 elements (H through Ca)',
    }
  }
  const showCounts = booleanField(p.showShellCounts, 'atom_shell', 'showShellCounts', true)
  if (!showCounts.ok) return showCounts
  return {
    ok: true,
    figure: {
      template: 'atom_shell',
      params: {
        symbol: entry.symbol,
        atomicNumber: entry.atomicNumber,
        shells: entry.shells,
        showShellCounts: showCounts.value,
      },
    },
  }
}

/**
 * Lenient parse for the browser, which must be able to render a persisted call.
 * @param payload - candidate figure payload.
 * @returns normalized parameters, or null when they are not usable.
 */
export function parseFigurePayload(payload: unknown): FigurePayload | null {
  const checked = checkFigurePayload(payload)
  return checked.ok ? checked.figure : null
}

/**
 * One factual line for the model-facing summary.
 * @param figure - normalized figure.
 * @returns a short description of the figure's semantics.
 */
export function summarizeFigure(figure: FigurePayload): string {
  if (figure.template === 'incline_force') {
    const p = figure.params
    return `incline_force: θ=${p.angleDeg}°, m=${p.massKg} kg, μ=${p.frictionCoeff}`
  }
  if (figure.template === 'orbital_diagram') {
    const p = figure.params
    return `orbital_diagram: ${p.symbol} (Z=${p.atomicNumber})`
  }
  if (figure.template === 'connected_bodies') {
    const p = figure.params
    return `connected_bodies: m₁=${p.surfaceMassKg} kg, m₂=${p.hangingMassKg} kg, μ=${p.frictionCoeff}`
  }
  const p = figure.params
  return `atom_shell: ${p.symbol}, Z=${p.atomicNumber}, shells ${p.shells.join(',')}`
}
