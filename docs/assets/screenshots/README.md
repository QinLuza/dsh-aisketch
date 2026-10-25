# Screenshots

All images in this directory are **card crops rendered by this plugin inside a live DSH session** (dsh `0.1.7-rc.2`), not mockups or design comps.

- No account, avatar, workspace path, API key, model provider, or conversation text is included; each image is cropped to the card surface.
- The content is generic teaching material: `sin(x)`, `x^2`, a physics formula table, a parity flowchart, Zn/Na electron models, and a mountain-lake illustration.
- Reproduce them with the prompts in [`../showcase-prompts.md`](../showcase-prompts.md).

| File | Capability |
|---|---|
| `sketch-single.png` | `sketch_function` · `plain` |
| `sketch-compare.png` | `sketch_function` · `compare` |
| `sketch-tangent.png` | `sketch_function` · `tangent` |
| `sketch-riemann.png` | `sketch_function` · `riemann` |
| `sketch-taylor.png` | `sketch_function` · `taylor` |
| `sketch-data.png` | `sketch_function` · `data` (bar) |
| `table-physics.png` | `show_card` · `table` |
| `flowchart-parity.png` | `show_card` · `flowchart` (expanded view) |
| `draw-illustration.png` | `show_card` · `draw` (final, 1200×800) |
| `draw-dashed-prism.png` | `draw` · `path.dash` on hidden edges + `strokeOpacity` |
| `draw-gradient-dusk.png` | `draw` · linear sky/sea gradient + radial sun glow |
| `draw-light-blur.png` | `draw` · `blend: screen/multiply` + `blur` light shaft |
| `draw-scene-snapshot.png` | `draw` · rendered through the bitmap snapshot path |
| `figure-incline-30.png` | `show_card` · `figure` · `incline_force` |
| `figure-connected-table-pulley.png` | `show_card` · `figure` · `connected_bodies` |
| `figure-orbital-zn.png` | `show_card` · `figure` · `orbital_diagram` |
| `figure-atom-na.png` | `show_card` · `figure` · `atom_shell` |

To replace a screenshot, render the corresponding card in DSH, crop to the card bounds (including its header), and keep the same file name.
