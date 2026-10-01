/**
 * AISketch bundle, node half.
 *
 * A bundle package carries no behavior of its own: its whole contribution is
 * `cordis.patch.yml`, which the Loader applies when a profile lists this
 * package under `dsh.profile.bundles`. This module exists so the package has a
 * valid entry point and can be resolved like any other plugin.
 */

/** Bundle plugin body — the patch file is the deliverable, not this function. */
export function apply(): void {}
