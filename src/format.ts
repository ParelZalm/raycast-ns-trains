import { Color } from "@raycast/api"
import { Crowd, StopTime, TrainStock, TrainTrip } from "./api/ns"

const timeFormat = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })

export function formatTime(date: Date): string {
  return timeFormat.format(date)
}

export function formatDelay(stop: StopTime): string | undefined {
  return stop.delayMinutes > 0 ? `+${stop.delayMinutes}` : undefined
}

export function formatStopTime(stop: StopTime): string {
  const delay = formatDelay(stop)
  return delay ? `${formatTime(stop.actual)} (${delay}, was ${formatTime(stop.planned)})` : formatTime(stop.actual)
}

export function formatTrack(stop: StopTime): string | undefined {
  if (!stop.track) return undefined
  return stop.trackChanged ? `Spoor ${stop.track} (changed)` : `Spoor ${stop.track}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function formatStock(stock: TrainStock): string {
  const parts = [stock.type, `${stock.carriages} carriages`, stock.lengthInMeters && `${stock.lengthInMeters} m`]
  return parts.filter(Boolean).join(" · ") + (stock.shortened ? " (shorter than usual)" : "")
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100)
}

export function minutesUntil(date: Date): number {
  return Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000))
}

export const crowdLabel: Record<Crowd, string> = {
  LOW: "Quiet",
  MEDIUM: "Busy",
  HIGH: "Very busy",
  UNKNOWN: "Unknown",
}

export const crowdColor: Record<Crowd, Color> = {
  LOW: Color.Green,
  MEDIUM: Color.Orange,
  HIGH: Color.Red,
  UNKNOWN: Color.SecondaryText,
}

export function statusLabel(trip: TrainTrip): string | undefined {
  if (trip.cancelled) return "Cancelled"
  switch (trip.status) {
    case "NORMAL":
      return undefined
    case "DISRUPTION":
      return "Disruption"
    case "MAINTENANCE":
      return "Maintenance"
    case "ALTERNATIVE_TRANSPORT":
    case "REPLACEMENT":
      return "Replacement transport"
    case "CHANGE_NOT_POSSIBLE":
      return "Transfer not possible"
    case "UNCERTAIN":
      return "Uncertain"
    default:
      return undefined
  }
}
