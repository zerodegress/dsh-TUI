/**
 * The header maid portrait floats transparent (fake Windows Terminal).
 *
 * The dsh-tui.whaleGirl setting renders the author's transparent-background
 * PNG through the terminal image protocols. The contract pinned here,
 * against the same fake Windows Terminal the inline-math probe uses (DA1
 * "?61;4;...c" selects Sixel; WT's default conformance honours background
 * select 1, so an unbacked raster really is transparent):
 * - the portrait reaches the frame as a transcript placement with
 *   transparent: true and no background — Sixel paints only her pixels
 *   and the terminal background/wallpaper shows through around her
 *   silhouette;
 * - the placement honors the caller's cell budget (a non-empty box), and the
 *   raster handed to the protocol is that box's own physical pixels with the
 *   artwork scaled into them — a terminal that paints a payload without
 *   scaling it must find her as large as the reserved slot (issue #1381,
 *   where she arrived at her native pixel size inside a HiDPI slot).
 *
 * Run: node --import tsx/esm scripts/verify-maid-portrait-transparent.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'

import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import { AlternateScreen, Box, render } from '../src/ui.js'
import { MaidPortrait } from '../src/components/maidPortrait.js'
import { ThemeProvider } from '../src/components/design-system/ThemeProvider.js'
import instances from '../src/ink/instances.js'
import { fitTerminalImageSource } from '../src/ink/terminal-image.js'
import type { TerminalImagePlacement, TerminalImageSource } from '../src/ink/terminal-image.js'

// A stand-in for the trimmed whale-girl art: fully transparent surround
// (the trimmed canvas margins), opaque body, and a soft anti-aliased edge —
// the exact alpha profile the portrait ships with.
const W = 64, H = 64
const data = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inside = x >= 16 && x < 48 && y >= 8 && y < 56
    const edge = inside && (x < 19 || x >= 45 || y < 11 || y >= 53)
    const alpha = inside ? (edge ? 128 : 255) : 0
    const i = (y * W + x) * 4
    data[i] = 240; data[i + 1] = 200; data[i + 2] = 210; data[i + 3] = alpha
  }
}
const portrait: TerminalImageSource = { data, width: W, height: H }

class Input extends PassThrough {
  isTTY = true
  setRawMode(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
}
class Output extends Writable {
  isTTY = true
  columns = 80
  rows = 24
  data = ''
  _write(chunk: unknown, _encoding: BufferEncoding, done: () => void): void {
    const text = String(chunk)
    this.data += text
    const reply = text === '\x1b[c' ? '\x1b[?61;4;28c'
      : text === '\x1b[?80$p' ? '\x1b[?80;1$y'
        : text === '\x1b[16t' ? '\x1b[6;20;10t'
          : text === '\x1b[14t' ? '\x1b[4;400;600t'
            : /^\x1b\]11;\?/.test(text) ? '\x1b]11;rgb:ffff/ffff/ffff\x1b\\' : ''
    if (reply) queueMicrotask(() => input.write(reply))
    done()
  }
}
const input = new Input()
const output = new Output()
const stderr = new Writable({ write(_chunk: unknown, _encoding: BufferEncoding, done: () => void): void { done() } })
const app = await render(
  <AlternateScreen>
    <ThemeProvider theme="light">
      <Box width={80} flexDirection="row" justifyContent="center">
        <MaidPortrait source={portrait} maxColumns={40} maxRows={15} presentation="transcript" />
      </Box>
    </ThemeProvider>
  </AlternateScreen>,
  {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr,
    exitOnCtrlC: false,
    patchConsole: false,
    terminalImages: true,
  },
)
const host = instances.get(output as unknown as NodeJS.WriteStream) as unknown as {
  frontFrame: { images?: readonly TerminalImagePlacement[] }
}
const placements = (): readonly TerminalImagePlacement[] => host.frontFrame.images ?? []
const settled = (): boolean => placements().some(value => value.presentation === 'transcript')
const deadline = Date.now() + 10_000
while (!settled() && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 20))
}
const placement = placements().find(value => value.presentation === 'transcript')
assert.ok(placement !== undefined, 'the portrait reaches the frame as a transcript placement')
assert.equal(placement.transparent, true, 'the portrait floats transparent — Sixel paints only her pixels')
assert.equal(placement.background, undefined, 'no backing colour slab behind her')
assert.ok(placement.columns > 0 && placement.rows > 0, 'the placement honors the cell budget')
// The cell size the fake terminal reports above (10x20), so the box's physical
// pixels are exactly the placement's cells.
const fitted = fitTerminalImageSource(
  portrait,
  placement.columns,
  placement.rows,
  { width: 10, height: 20 },
  'transcript',
)
assert.deepEqual(
  [fitted.width, fitted.height],
  [placement.columns * 10, placement.rows * 20],
  'the uploaded raster is the placement box physical pixels, not a smaller canvas the terminal has to scale up',
)
// Her drawn extent inside that raster: transparent margins stay transparent,
// and the artwork is enlarged to the box rather than centered at 64x64.
let left = fitted.width
let top = fitted.height
let right = -1
let bottom = -1
for (let y = 0; y < fitted.height; y++) {
  for (let x = 0; x < fitted.width; x++) {
    if (fitted.data[(y * fitted.width + x) * 4 + 3] === 0) continue
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
}
assert.ok(
  bottom - top + 1 >= fitted.height * 0.7 && right - left + 1 >= fitted.width * 0.4,
  `she fills the reserved slot (drawn ${right - left + 1}x${bottom - top + 1} of ${fitted.width}x${fitted.height})`,
)
// Upscaling runs through the premultiplied bilinear path: a flat interior must
// come back opaque and byte-identical, instead of picking up dark fringes.
const center = (Math.floor(fitted.height / 2) * fitted.width + Math.floor(fitted.width / 2)) * 4
assert.deepEqual([...fitted.data.subarray(center, center + 4)], [240, 200, 210, 255],
  'her body stays opaque and keeps her colours at the center of the box')
assert.equal(fitted.data[3], 0, 'the transparent surround stays empty, so no slab is painted behind her')
await app.unmount()
console.log('verify-maid-portrait-transparent: all assertions passed')
