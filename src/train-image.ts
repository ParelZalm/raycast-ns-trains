import { environment } from "@raycast/api"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TrainStock } from "./api/ns"

// Not to scale: traced after NS's own unit drawings, but every carriage is the same length and coupled
// units get a gap, so a single or double train is obvious at a glance.
const CARRIAGE = 26
const HEIGHT = 18
const NOSE = 8
const COUPLING = 4
// Raycast centres markdown images, so the train sits at the left of a canvas about as wide as the detail pane.
const CANVAS = 420

interface Livery {
  body: string
  bands: { color: string; y: number; height: number }[]
  windows: { y: number; height: number }[]
  cap?: string
  nose?: string
  cab: string
}

const YELLOW = "#FFC917"
const WINDOW = "#AEB4BE"
const UNDERFRAME = "#4A4F57"
const NS_BLUE = "#003082"
const INTERCITY: Livery = {
  body: YELLOW,
  bands: [{ color: NS_BLUE, y: 5, height: 7 }],
  windows: [{ y: 6, height: 4 }],
  cab: "#1B1F2B",
}
// VIRM and DDZ: an upper deck framed in blue above the lower deck's band.
const DOUBLE_DECKER: Livery = {
  body: YELLOW,
  bands: [
    { color: NS_BLUE, y: 3, height: 4 },
    { color: NS_BLUE, y: 9.5, height: 4 },
  ],
  windows: [
    { y: 3.5, height: 3 },
    { y: 10, height: 3 },
  ],
  cab: "#1B1F2B",
}
const SPRINTER: Livery = {
  body: "#EEF0F3",
  bands: [{ color: "#3367C8", y: 3, height: 7 }],
  windows: [{ y: 6, height: 4 }],
  cap: YELLOW,
  nose: "#2E323A",
  cab: "#1B1F2B",
}
const SPRINTER_TYPES = /^(flirt|sng|slt|sgm)/i
const DOUBLE_DECKER_TYPES = /^(virm|ddz|dd)/i

function livery(type: string): Livery {
  if (SPRINTER_TYPES.test(type)) return SPRINTER
  if (DOUBLE_DECKER_TYPES.test(type)) return DOUBLE_DECKER
  return INTERCITY
}

// Raycast markdown only shows images from a URL or a file, so each composition is drawn once into the support folder.
export function trainImageMarkdown(stock: TrainStock): string | undefined {
  const units = stock.units
    .filter((unit) => unit.carriages > 0)
    .map((unit) => ({ carriages: unit.carriages, livery: livery(unit.type) }))
  if (units.length === 0) return undefined
  const width = Math.max(CANVAS, units.reduce((sum, unit) => sum + unit.carriages * CARRIAGE + COUPLING, 0))
  const svg = trainSvg(units, width)
  // Named after the drawing itself, so a design change never shows a stale file.
  const dir = join(environment.supportPath, "trains")
  const path = join(dir, `${createHash("sha1").update(svg).digest("hex").slice(0, 16)}.svg`)
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, svg)
  }
  return `![](${encodeURI(`file://${path}`)}?raycast-width=${width}&raycast-height=${HEIGHT})`
}

function trainSvg(units: { carriages: number; livery: Livery }[], width: number): string {
  let x = 0
  const shapes = units.map(({ carriages, livery }, index) => {
    const svg = unitSvg(`unit${index}`, x, carriages * CARRIAGE, livery)
    x += carriages * CARRIAGE + COUPLING
    return svg
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${shapes.join("")}</svg>`
}

// One unit with a cab at both ends; everything is clipped to the body outline so the band and caps follow the noses.
function unitSvg(id: string, x: number, width: number, livery: Livery): string {
  const right = x + width
  const body = `M${x + NOSE},1 H${right - NOSE} Q${right - 1},2 ${right},${HEIGHT - 5} V${HEIGHT - 1} H${x} V${HEIGHT - 5} Q${x + 1},2 ${x + NOSE},1 Z`
  const parts = [
    `<rect x="${x}" y="0" width="${width}" height="${HEIGHT}" fill="${livery.body}"/>`,
    ...livery.bands.map((band) => `<rect x="${x}" y="${band.y}" width="${width}" height="${band.height}" fill="${band.color}"/>`),
  ]
  for (let left = x; left < right; left += CARRIAGE) {
    const first = left === x
    const last = left + CARRIAGE >= right
    const windowsFrom = left + (first ? NOSE + 3 : 3)
    const windowsTo = left + CARRIAGE - (last ? NOSE + 3 : 8)
    for (const row of livery.windows) {
      for (let window = windowsFrom; window + 4 <= windowsTo; window += 6) {
        parts.push(`<rect x="${window}" y="${row.y}" width="4" height="${row.height}" rx="0.5" fill="${WINDOW}"/>`)
      }
    }
    if (!last) {
      parts.push(`<rect x="${left + CARRIAGE - 6}" y="4" width="4" height="${HEIGHT - 7}" fill="${YELLOW}" stroke="${UNDERFRAME}" stroke-width="0.4"/>`)
      parts.push(`<rect x="${left + CARRIAGE - 0.5}" y="1" width="1" height="${HEIGHT - 2}" fill="${UNDERFRAME}" opacity="0.5"/>`)
    }
  }
  if (livery.cap) {
    parts.push(`<rect x="${x}" y="0" width="${NOSE + 4}" height="3" fill="${livery.cap}"/>`)
    parts.push(`<rect x="${right - NOSE - 4}" y="0" width="${NOSE + 4}" height="3" fill="${livery.cap}"/>`)
  }
  if (livery.nose) {
    parts.push(`<rect x="${x}" y="7" width="4" height="${HEIGHT}" fill="${livery.nose}"/>`)
    parts.push(`<rect x="${right - 4}" y="7" width="4" height="${HEIGHT}" fill="${livery.nose}"/>`)
  }
  parts.push(`<path d="M${x + 2.5},7.5 L${x + NOSE - 1},2.5 H${x + NOSE + 1.5} V7.5 Z" fill="${livery.cab}"/>`)
  parts.push(`<path d="M${right - 2.5},7.5 L${right - NOSE + 1},2.5 H${right - NOSE - 1.5} V7.5 Z" fill="${livery.cab}"/>`)
  parts.push(`<rect x="${x}" y="${HEIGHT - 3}" width="${width}" height="3" fill="${UNDERFRAME}"/>`)
  return `<clipPath id="${id}"><path d="${body}"/></clipPath><g clip-path="url(#${id})">${parts.join("")}</g>`
}
