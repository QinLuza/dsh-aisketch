/**
 * Build the browser half into the `./client` bundle dsh serves.
 *
 * The client module system reads a package's `./client` export off disk with
 * `readFileSync` and hands the bytes straight to the page -- it does not
 * transpile TypeScript. So the browser half has to be a prebuilt bundle, which
 * is why `exports['./client']` points at `lib/client.js` rather than at
 * `src/client/index.ts`. (The Host half is the opposite: it is imported by the
 * loader like any other plugin, and TypeScript sources are fine there.)
 *
 * What stays external is decided by the platform module table: React and the
 * `@deepseek-ai/dsh-client-*` services are supplied by the shipped web bundle,
 * and bundling a second React copy into a card would be a second React.
 * `@aisketch/cards-core` is ours and is inlined, which is the whole point of the
 * single-source private-inline layout.
 *
 * esbuild is resolved from the dsh checkout on purpose: this package keeps no
 * bundler of its own, and ESM `import` ignores NODE_PATH, so the binary is
 * located by absolute path.
 *
 * The wrapper below is not cosmetic -- it is the module system's calling
 * convention, and getting it wrong produces `ReferenceError: module is not
 * defined` at boot and a "Failed to load plugins" page. The shipped bundles are
 * built by `packages/client/tsdown.client.ts`, whose output is:
 *
 *     window.__ModuleLoader__.load({
 *       id: "<package name>",
 *       factory: (require) => {
 *         var module = { exports: {} };          // tsdown `intro`
 *         var exports = module.exports;
 *         ...
 *         return module.exports;                 // tsdown `footer`
 *       }
 *     });
 *
 * `format: 'cjs'` therefore stays: inside the factory, `require` is the
 * parameter, so every external below resolves through the platform module
 * table. esbuild has no `intro`, so the `module`/`exports` declaration rides in
 * the banner instead.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Absolute path of an installed esbuild, or `undefined`. */
function findEsbuild() {
  // Resolution order: an explicit override, this package's own devDependency,
  // then the workspace root's. pnpm keeps the real copy under `.pnpm`, so both
  // layouts are probed -- no absolute path from the author's machine is baked in.
  const roots = [
    process.env.CARDS_ESBUILD,
    process.env.SKETCH_ESBUILD,
    join(here, 'node_modules', 'esbuild'),
    join(here, '..', '..', 'node_modules', 'esbuild'),
    join(here, 'node_modules', '.pnpm'),
    join(here, '..', '..', 'node_modules', '.pnpm'),
  ].filter((value) => typeof value === 'string' && value !== '')
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (root.endsWith('esbuild')) return root
    const hits = readdirSync(root)
      .filter((name) => name.startsWith('esbuild@'))
      .sort()
      .reverse()
    for (const hit of hits) {
      const candidate = join(root, hit, 'node_modules', 'esbuild')
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  return undefined
}

const esbuildDir = findEsbuild()
if (esbuildDir === undefined) {
  console.error('build-client: esbuild not found; set CARDS_ESBUILD to its package directory')
  process.exit(1)
}
const esbuild = require(esbuildDir)

// Read from package.json rather than restated: the id stamped into the bundle
// must equal the package name, because that is the key the module system
// matches against the `./client` export it discovered.
const PACKAGE_NAME = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).name

const outDir = join(here, 'lib')
mkdirSync(outDir, { recursive: true })

await esbuild.build({
  entryPoints: [join(here, 'src', 'client', 'index.ts')],
  outfile: join(outDir, 'client.js'),
  bundle: true,
  // The client module system evaluates these bundles the same way it does the
  // shipped ones, which are CJS.
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  // Supplied by the platform module table; a second copy would be a bug.
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/*'],
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `  id: ${JSON.stringify(PACKAGE_NAME)},`,
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: '    return module.exports;\n  }\n});\n' },
  logLevel: 'info',
  logOverride: { 'ignored-bare-import': 'silent' },
})

console.log(`build-client: ${resolve(outDir, 'client.js')}`)