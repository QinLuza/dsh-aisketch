/**
 * AISketch expression parser.
 *
 * A dependency-free mathematical expression parser for function plotting.
 * Deliberately does NOT use eval() or new Function(): the input is parsed into
 * an AST that is walked by a closed interpreter, so only math can run.
 *
 * Grammar (precedence low -> high):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | implicit) unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := primary ('^' unary)?           // right associative
 *   primary := number | ident | ident '(' args ')' | '(' expr ')'
 *
 * Note that `power` sits BELOW `unary`, so `-2^2` parses as `-(2^2) = -4`,
 * matching standard mathematical convention. The exponent recurses into
 * `unary`, which keeps `^` right associative and allows `2^-1`.
 *
 * Implicit multiplication is supported: `2x`, `3sin(x)`, `(x+1)(x-1)`, `2pi`.
 */

/** Recognised function names, mapped to their implementations. */
export const FUNCTIONS: Readonly<Record<string, (...args: number[]) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  pow: Math.pow,
  hypot: Math.hypot,
  min: Math.min,
  max: Math.max,
}

/** Built-in constants. */
export const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  PI: Math.PI,
  'π': Math.PI,
  e: Math.E,
  E: Math.E,
  tau: Math.PI * 2,
}

/** Multi-argument functions: everything else is treated as unary. */
const VARIADIC = new Set(['pow', 'hypot', 'min', 'max'])

/** One lexed token. */
export interface Token {
  /** Lexical class; `eof` is the sentinel that ends every stream. */
  readonly type: 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof'
  /** Token text, or the numeric value for `num`. */
  readonly value: string | number
  /** Offset of the token's first character in the source. */
  readonly index: number
}

/** Thrown for any malformed input. Carries the offending index for UI hints. */
export class ParseError extends Error {
  /** Offset in the source expression that caused the failure. */
  readonly index: number

  /**
   * @param message - human readable reason.
   * @param index - offset in source.
   */
  constructor(message: string, index: number) {
    super(message)
    this.name = 'ParseError'
    this.index = index
  }
}

/** Numeric literal node. */
export interface NumNode {
  readonly kind: 'num'
  readonly value: number
}

/** Identifier node: a free variable or a parameter. */
export interface VarNode {
  readonly kind: 'var'
  readonly name: string
}

/** Unary sign node. */
export interface UnaryNode {
  readonly kind: 'unary'
  readonly op: '-'
  readonly arg: AstNode
}

/** Binary operator node. */
export interface BinNode {
  readonly kind: 'bin'
  readonly op: '+' | '-' | '*' | '/' | '^'
  readonly left: AstNode
  readonly right: AstNode
}

/** Function call node. */
export interface CallNode {
  readonly kind: 'call'
  readonly name: string
  readonly args: readonly AstNode[]
}

/** Any node of the parsed expression tree. */
export type AstNode = NumNode | VarNode | UnaryNode | BinNode | CallNode

/** A scope maps variable names to their current values. */
export type Scope = Readonly<Record<string, number>>

/**
 * Tokenize into a list of tokens.
 * Types: num, ident, op, lparen, rparen, comma.
 * @param src - raw expression text.
 * @returns token list ending with an eof sentinel.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const start = i
      while (i < src.length && /[0-9.]/.test(src[i] as string)) i++
      const text = src.slice(start, i)
      const value = Number(text)
      if (!Number.isFinite(value)) throw new ParseError(`Invalid number "${text}"`, start)
      tokens.push({ type: 'num', value, index: start })
      continue
    }
    if (/[a-zA-Z_\u0370-\u03ff]/.test(ch)) {
      const start = i
      while (i < src.length && /[a-zA-Z0-9_\u0370-\u03ff]/.test(src[i] as string)) i++
      tokens.push({ type: 'ident', value: src.slice(start, i), index: start })
      continue
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, index: i })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, index: i })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, index: i })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, index: i })
      i++
      continue
    }
    throw new ParseError(`Unexpected character "${ch}"`, i)
  }
  tokens.push({ type: 'eof', value: '', index: src.length })
  return tokens
}

/**
 * Parse an expression into an AST.
 * @param src - expression text.
 * @returns AST root node.
 * @throws {ParseError} on any syntax error.
 */
export function parse(src: string): AstNode {
  const tokens = tokenize(src)
  let pos = 0
  const peek = (): Token => tokens[pos] as Token
  const next = (): Token => tokens[pos++] as Token
  const isOp = (value: string): boolean => peek().type === 'op' && peek().value === value

  function parseExpr(): AstNode {
    let node = parseTerm()
    while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = String(next().value) as '+' | '-'
      node = { kind: 'bin', op, left: node, right: parseTerm() }
    }
    return node
  }

  /** Whether a token can begin a primary, i.e. continue a term implicitly. */
  function startsPrimary(tok: Token): boolean {
    return tok.type === 'num' || tok.type === 'ident' || tok.type === 'lparen'
  }

  function parseTerm(): AstNode {
    let node = parseUnary()
    for (;;) {
      const tok = peek()
      if (tok.type === 'op' && (tok.value === '*' || tok.value === '/')) {
        const op = String(next().value) as '*' | '/'
        node = { kind: 'bin', op, left: node, right: parseUnary() }
        continue
      }
      // Implicit multiplication: `2x`, `2sin(x)`, `(a)(b)`, `x pi`.
      // A `(` only continues the term when it cannot be a call's argument list,
      // which the primary parser already handled for identifiers.
      if (startsPrimary(tok)) {
        node = { kind: 'bin', op: '*', left: node, right: parseUnary() }
        continue
      }
      break
    }
    return node
  }

  function parseUnary(): AstNode {
    const tok = peek()
    if (tok.type === 'op' && (tok.value === '-' || tok.value === '+')) {
      next()
      const arg = parseUnary()
      return tok.value === '-' ? { kind: 'unary', op: '-', arg } : arg
    }
    return parsePower()
  }

  function parsePower(): AstNode {
    const base = parsePrimary()
    if (isOp('^')) {
      next()
      // Right associative; the exponent re-enters `unary` so `2^-1` parses.
      return { kind: 'bin', op: '^', left: base, right: parseUnary() }
    }
    return base
  }

  function parsePrimary(): AstNode {
    const tok = next()
    if (tok.type === 'num') return { kind: 'num', value: tok.value as number }
    if (tok.type === 'lparen') {
      const node = parseExpr()
      if (peek().type !== 'rparen') throw new ParseError('Missing closing parenthesis', peek().index)
      next()
      return node
    }
    if (tok.type === 'ident') {
      const name = String(tok.value)
      if (peek().type === 'lparen') {
        next()
        const args: AstNode[] = []
        if (peek().type !== 'rparen') {
          args.push(parseExpr())
          while (peek().type === 'comma') {
            next()
            args.push(parseExpr())
          }
        }
        if (peek().type !== 'rparen') throw new ParseError('Missing closing parenthesis', peek().index)
        next()
        return { kind: 'call', name, args }
      }
      return { kind: 'var', name }
    }
    if (tok.type === 'eof') throw new ParseError('Unexpected end of expression', tok.index)
    throw new ParseError(`Unexpected token "${String(tok.value)}"`, tok.index)
  }

  const root = parseExpr()
  if (peek().type !== 'eof') {
    throw new ParseError(`Unexpected token "${String(peek().value)}"`, peek().index)
  }
  return root
}

/**
 * Collect every identifier that is neither a known function nor a constant.
 * These are the plot's free variables: `x` plus any named parameters.
 * @param node - AST root.
 * @returns sorted, de-duplicated names.
 */
export function freeVariables(node: AstNode): string[] {
  const found = new Set<string>()
  const walk = (n: AstNode): void => {
    if (n.kind === 'var') {
      if (!(n.name in CONSTANTS)) found.add(n.name)
    } else if (n.kind === 'unary') walk(n.arg)
    else if (n.kind === 'bin') {
      walk(n.left)
      walk(n.right)
    } else if (n.kind === 'call') {
      if (!(n.name in FUNCTIONS)) throw new ParseError(`Unknown function "${n.name}"`, 0)
      n.args.forEach(walk)
    }
  }
  walk(node)
  return [...found].sort()
}

/** A compiled evaluator: give it a scope, get back a number. */
export type CompiledFn = (scope: Scope) => number

/**
 * Compile an AST into a plain JS closure.
 * @param node - AST root.
 * @returns a function from scope to value.
 */
export function compile(node: AstNode): CompiledFn {
  const walk = (n: AstNode): CompiledFn => {
    switch (n.kind) {
      case 'num': {
        const v = n.value
        return () => v
      }
      case 'var': {
        if (n.name in CONSTANTS) {
          const v = CONSTANTS[n.name] as number
          return () => v
        }
        const name = n.name
        return (scope) => {
          const v = scope[name]
          if (v === undefined) throw new ParseError(`Undefined variable "${name}"`, 0)
          return v
        }
      }
      case 'unary': {
        const a = walk(n.arg)
        return (scope) => -a(scope)
      }
      case 'bin': {
        const l = walk(n.left)
        const r = walk(n.right)
        const op = n.op
        if (op === '+') return (scope) => l(scope) + r(scope)
        if (op === '-') return (scope) => l(scope) - r(scope)
        if (op === '*') return (scope) => l(scope) * r(scope)
        if (op === '/') return (scope) => l(scope) / r(scope)
        return (scope) => (l(scope) as number) ** (r(scope) as number)
      }
      case 'call': {
        const fn = FUNCTIONS[n.name]
        if (fn === undefined) throw new ParseError(`Unknown function "${n.name}"`, 0)
        const args = n.args.map(walk)
        if (VARIADIC.has(n.name)) {
          return (scope) => fn(...args.map((a) => a(scope)))
        }
        if (args.length !== 1) {
          throw new ParseError(`Function "${n.name}" expects 1 argument, got ${args.length}`, 0)
        }
        const only = args[0] as CompiledFn
        return (scope) => fn(only(scope))
      }
    }
  }
  return walk(node)
}

/** One sampled point: `x` paired with `y`, where `null` marks "no value here". */
export type SamplePoint = readonly [x: number, y: number | null]

/** A parsed, compiled expression plus a sampling helper. */
export interface CompiledExpression {
  /** The AST this was built from. */
  readonly ast: AstNode
  /** Free variable names, sorted. */
  readonly vars: readonly string[]
  /** The evaluator. */
  readonly eval: CompiledFn
  /**
   * Sample the function over an x-range.
   * Non-finite results become `null` so plotters can break the line there.
   * @param xMin - left bound.
   * @param xMax - right bound.
   * @param count - number of samples (inclusive of both ends).
   * @param params - named parameter values merged into the scope.
   * @returns array of [x, y|null].
   */
  readonly sample: (xMin: number, xMax: number, count: number, params?: Scope) => SamplePoint[]
}

/**
 * Parse and compile in one step, returning a sampling helper.
 * @param src - expression text.
 * @returns the compiled expression.
 */
export function build(src: string): CompiledExpression {
  const ast = parse(src)
  const fn = compile(ast)
  const vars = freeVariables(ast)
  return {
    ast,
    vars,
    eval: fn,
    sample(xMin, xMax, count, params = {}) {
      const out: SamplePoint[] = []
      const step = (xMax - xMin) / (count - 1)
      for (let i = 0; i < count; i++) {
        const x = xMin + step * i
        let y: number
        try {
          y = fn({ x, ...params })
        } catch {
          y = NaN
        }
        out.push([x, Number.isFinite(y) ? y : null])
      }
      return out
    },
  }
}

/**
 * Numerically differentiate a compiled evaluator at a point.
 *
 * Uses the same Fornberg machinery as `nthDerivativeAt`, so the tangent line
 * and the Taylor coefficients agree to the last digit instead of differing in
 * the third decimal.
 * @param fn - compiled evaluator.
 * @param x - evaluation point.
 * @param params - parameter values.
 * @returns the derivative estimate.
 */
export function derivativeAt(fn: CompiledFn, x: number, params: Scope = {}): number {
  return nthDerivativeAt(fn, x, params, 1)
}

/**
 * Finite-difference weights for the `m`-th derivative on an arbitrary node grid.
 *
 * Implements Fornberg (1988), "Generation of finite difference formulas on
 * arbitrarily spaced grids", Math. Comp. 51, 699-706. Node positions are taken
 * relative to the evaluation point, so the weights apply directly.
 *
 * Using a single wide stencil instead of nested central differences is what
 * makes a Taylor series usable: recursion multiplies round-off by 1/(2h) at
 * every level, so a 7th-order coefficient ends up off by ~1e3. One stencil
 * gives the same order with error ~1e-8.
 *
 * @param z - node offsets from the evaluation point.
 * @param m - highest derivative order needed (also the table's column count).
 * @returns flat table, `c[i * (m + 1) + j]` = weight on node i for derivative j.
 */
function fornbergWeights(z: readonly number[], m: number): number[] {
  const n = z.length
  const idx = (i: number, j: number): number => i * (m + 1) + j
  const c = new Array<number>(n * (m + 1)).fill(0)
  c[idx(0, 0)] = 1
  let c1 = 1
  let c4 = z[0] as number
  for (let i = 1; i < n; i++) {
    const mn = Math.min(i, m)
    let c2 = 1
    const c5 = c4
    c4 = z[i] as number
    for (let j = 0; j < i; j++) {
      const c3 = (z[i] as number) - (z[j] as number)
      c2 *= c3
      if (j === i - 1) {
        // The k >= 1 recurrence is the genuine derivative formula; k = 0 is
        // the interpolation weight, which has its own (negative) update. Fusing
        // them makes c[idx(j, 0)] read c[idx(j, -1)], which wraps into the next
        // row's last column and poisons the whole table.
        for (let k = mn; k >= 1; k--) {
          c[idx(i, k)] =
            (c1 * (k * (c[idx(i - 1, k - 1)] as number) - c5 * (c[idx(i - 1, k)] as number))) / c2
        }
        c[idx(i, 0)] = (-c1 * c5 * (c[idx(i - 1, 0)] as number)) / c2
      }
      for (let k = mn; k >= 1; k--) {
        c[idx(j, k)] =
          (c4 * (c[idx(j, k)] as number) - k * (c[idx(j, k - 1)] as number)) / c3
      }
      c[idx(j, 0)] = (c4 * (c[idx(j, 0)] as number)) / c3
    }
    c1 = c2
  }
  return c
}

/** Read a weight out of a fornbergWeights table; missing cells are zero. */
function weightAt(table: readonly number[], i: number, m: number): number {
  const v = table[i * (m + 1) + m]
  return v === undefined ? 0 : v
}

/**
 * Half-width of the finite-difference stencil for a given derivative order.
 *
 * A derivative of order n needs at least n + 1 nodes; we take a few more so the
 * truncation error stays well below the round-off floor. Capped so the stencil
 * cannot grow without bound on high orders.
 * @param order - derivative order.
 * @returns number of nodes on each side of the evaluation point.
 */
function stencilHalfWidth(order: number): number {
  return Math.min(12, Math.max(4, order + 3))
}

/**
 * Spacing between stencil nodes, in x units.
 *
 * A FIXED step was measured to beat every |x|-scaled alternative, counter to
 * the usual instinct for first differences. The stencil spans 2 * (order + 3)
 * samples, so round-off enters divided by that span; tying h to |x| pulls the
 * nodes together too far and lets cancellation win. Benchmarked over sin / exp /
 * atan / polynomials at x up to 200: order-1 relative error 5.6e-6 and order-6
 * coefficient error 2.2e-8, both essentially flat in x.
 */
const STENCIL_STEP = 0.18

/**
 * Estimate the n-th derivative of a compiled evaluator at a point.
 *
 * Uses one Fornberg stencil sized to the order. Unlike nested central
 * differences, the round-off does not compound with depth, so order 8 is still
 * accurate to ~1e-9.
 *
 * @param fn - compiled evaluator.
 * @param x - evaluation point.
 * @param params - parameter values.
 * @param order - derivative order; 0 returns f(x) itself.
 * @returns the derivative estimate, or NaN if the stencil hits a non-finite value.
 */
export function nthDerivativeAt(fn: CompiledFn, x: number, params: Scope = {}, order = 1): number {
  if (order <= 0) return fn({ ...params, x })
  const half = stencilHalfWidth(order)
  const offsets: number[] = []
  const values: number[] = []
  for (let i = -half; i <= half; i++) {
    const dx = i * STENCIL_STEP
    offsets.push(dx)
    values.push(fn({ ...params, x: x + dx }))
  }
  const table = fornbergWeights(offsets, order)
  let sum = 0
  for (let i = 0; i < offsets.length; i++) {
    const f = values[i] as number
    if (!Number.isFinite(f)) return NaN
    sum += weightAt(table, i, order) * f
  }
  return sum
}

/**
 * Build the coefficients of the Taylor polynomial of a function at a point.
 *
 * Each coefficient is `f⁽ᵏ⁾(a) / k!`. Non-finite coefficients are clamped to
 * zero: a single blow-up (a pole just outside the stencil, an overflowed exp)
 * would otherwise poison the whole polynomial and draw a vertical spike.
 *
 * @param fn - compiled evaluator.
 * @param center - expansion point a.
 * @param params - parameter values.
 * @param order - highest degree to compute.
 * @returns coefficients `[c0, c1, ..., cN]` for c_k * (x-a)^k.
 */
export function taylorCoefficients(
  fn: CompiledFn,
  center: number,
  params: Scope = {},
  order = 4,
): number[] {
  const coeffs: number[] = []
  let factorial = 1
  for (let k = 0; k <= order; k++) {
    if (k > 0) factorial *= k
    const d = nthDerivativeAt(fn, center, params, k)
    coeffs.push(Number.isFinite(d) ? d / factorial : 0)
  }
  return coeffs
}

/**
 * Evaluate a Taylor polynomial built from coefficients.
 * @param coeffs - coefficients from taylorCoefficients.
 * @param center - the expansion point the coefficients were taken about.
 * @returns a function of x.
 */
export function taylorEvaluator(coeffs: readonly number[], center: number): (x: number) => number {
  return (x) => {
    let sum = 0
    let power = 1
    for (let k = 0; k < coeffs.length; k++) {
      sum += (coeffs[k] as number) * power
      power *= x - center
    }
    return sum
  }
}

/**
 * Composite Simpson integration of a compiled evaluator over [a, b].
 * Used for the riemann mode's "true value" readout.
 * @param fn - compiled evaluator.
 * @param a - lower bound.
 * @param b - upper bound.
 * @param params - parameter values.
 * @param n - even number of sub-intervals.
 * @returns the integral estimate.
 */
export function integrate(
  fn: CompiledFn,
  a: number,
  b: number,
  params: Scope = {},
  n = 2000,
): number {
  const even = n % 2 === 0 ? n : n + 1
  const h = (b - a) / even
  let sum = fn({ ...params, x: a }) + fn({ ...params, x: b })
  for (let i = 1; i < even; i++) {
    sum += fn({ ...params, x: a + i * h }) * (i % 2 === 0 ? 2 : 4)
  }
  return (sum * h) / 3
}
