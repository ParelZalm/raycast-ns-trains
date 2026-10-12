import { useEffect, useRef, useState } from "react"

// Raycast has no CSS animations, so titles flip like an old departure board by re-rendering every frame:
// each digit flaps forward through 0–9 until it lands, left to right and row by row.
const FLIP_MS = 45
const CHAR_STAGGER_MS = 50
const ROW_STAGGER_MS = 90

type Flap = { from: string; to: string; start: number }

// New rows flap in from scrambled digits; when a refresh changes a row (a new delay), only its changed digits flip.
export function useSplitFlap(rows: { id: string; text: string }[]) {
  const flaps = useRef(new Map<string, Flap>())
  const [now, setNow] = useState(Date.now)

  const renderedAt = Date.now()
  let queued = 0
  for (const { id, text } of rows) {
    const flap = flaps.current.get(id)
    if (flap?.to === text) continue
    flaps.current.set(id, { from: flap?.to ?? scramble(id, text), to: text, start: renderedAt + queued++ * ROW_STAGGER_MS })
  }

  const settled = Math.max(0, ...[...flaps.current.values()].map(settledAt))
  const flapping = queued > 0 || now < settled
  useEffect(() => {
    if (!flapping) return
    const timer = setInterval(() => setNow(Date.now()), FLIP_MS)
    return () => clearInterval(timer)
  }, [flapping])

  return (id: string, text: string): string => {
    const flap = flaps.current.get(id)
    if (!flap || flap.to !== text) return text
    return [...flap.to].map((target, index) => flipDigit(flap, index, target, now)).join("")
  }
}

function flipDigit(flap: Flap, index: number, target: string, now: number): string {
  const from = [...flap.from][index]
  if (!isDigit(target) || !isDigit(from)) return target
  const flips = (Number(target) - Number(from) + 10) % 10
  const elapsed = Math.floor((now - flap.start - index * CHAR_STAGGER_MS) / FLIP_MS)
  return String((Number(from) + Math.max(0, Math.min(flips, elapsed))) % 10)
}

function settledAt(flap: Flap): number {
  return flap.start + flap.to.length * CHAR_STAGGER_MS + 9 * FLIP_MS
}

// Deterministic per trip, so a re-render mid-animation doesn't reshuffle the starting digits.
function scramble(id: string, text: string): string {
  let hash = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 7)
  return [...text]
    .map((char) => {
      hash = (hash * 1103515245 + 12345) | 0
      return isDigit(char) ? String(Math.abs(hash >> 8) % 10) : char
    })
    .join("")
}

function isDigit(char: string | undefined): char is string {
  return char !== undefined && char >= "0" && char <= "9"
}
