/**
 * AISketch client plugin, node half. This is a pure UI plugin: the empty apply
 * exists so the plugin appears in the profile's cordis patch and can be
 * discovered by the browser runtime through the package.json `dsh.client`
 * declaration.
 */

/** Host plugin body — no host-side behavior for this UI plugin. */
export function apply(): void {}
