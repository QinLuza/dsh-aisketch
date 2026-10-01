/**
 * AISketch core: expression parsing, closed-interpreter evaluation, numerical
 * methods, spec compaction, and geometry resolution.
 *
 * Zero runtime dependencies and no `eval` / `new Function` anywhere in the
 * graph — the expression string is parsed into an AST that a closed interpreter
 * walks, so the only thing a caller can execute is arithmetic.
 */

export {
  FUNCTIONS,
  CONSTANTS,
  ParseError,
  tokenize,
  parse,
  freeVariables,
  compile,
  build,
  derivativeAt,
  nthDerivativeAt,
  taylorCoefficients,
  taylorEvaluator,
  integrate,
} from './parser.ts'
export type {
  Token,
  AstNode,
  NumNode,
  VarNode,
  UnaryNode,
  BinNode,
  CallNode,
  Scope,
  CompiledFn,
  SamplePoint,
  CompiledExpression,
} from './parser.ts'

export {
  LEVEL,
  DEFAULT_KEEP_TURNS,
  FULL_PER_TURN,
  DEFAULT_FORGET_AFTER,
  toSummary,
  toReference,
  isReference,
  isSummary,
  kindOf,
  describe,
  compact,
  estimateTokens,
  applyEdit,
} from './compact.ts'
export type {
  LevelName,
  SketchSpec,
  SummarySpec,
  ReferenceSpec,
  AnySpec,
  ParamSpec,
  SpecRange,
  Turn,
  CompactOptions,
  EditResult,
} from './compact.ts'

export {
  MODES,
  isMode,
  normalizeMode,
  resolveXRange,
  autoRangeY,
  freezeYRange,
  resolveGeometry,
  splitCurveLine,
} from './geometry.ts'
export type {
  Mode,
  Range,
  Point,
  CurveGeometry,
  TangentGeometry,
  RiemannGeometry,
  TaylorGeometry,
  SketchGeometry,
} from './geometry.ts'
