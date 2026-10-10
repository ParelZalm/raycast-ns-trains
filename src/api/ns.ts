// NS Reisinformatie API (v3 trips) mapped to the few fields the commands show.
import { getPreferenceValues } from "@raycast/api"
import { Cached, RateLimitError, backOff, readCache, takeRequestSlot, writeCache } from "./limiter"

const BASE_URL = "https://gateway.apiportal.ns.nl"
const TRIPS_FRESH_MS = 60_000
const TRIPS_FORCED_FRESH_MS = 15_000
const STATIONS_FRESH_MS = 7 * 24 * 60 * 60_000

export type Crowd = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"

export interface StopTime {
  station: string
  planned: Date
  actual: Date
  delayMinutes: number
  track?: string
  trackChanged: boolean
}

export interface TrainLeg {
  product: string
  category: string
  direction?: string
  departure: StopTime
  arrival: StopTime
  cancelled: boolean
  crowd: Crowd
  intermediateStops: string[]
}

export interface TrainTrip {
  id: string
  departure: StopTime
  arrival: StopTime
  durationMinutes: number
  transfers: number
  status: string
  cancelled: boolean
  crowd: Crowd
  punctuality?: number
  priceInCents?: number
  shareUrl?: string
  messages: string[]
  legs: TrainLeg[]
}

export interface TripsResult {
  trips: TrainTrip[]
  fetchedAt: Date
  // Why cached trips were served instead of fresh ones (rate limit, network error).
  staleReason?: string
}

export interface Station {
  code: string
  name: string
  country: string
  keywords: string[]
}

export interface Route {
  from: string
  to: string
}

class NsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

interface Preferences {
  apiKey: string
  fromStation: string
  toStation: string
}

interface NsEndpoint {
  name?: string
  plannedDateTime?: string
  actualDateTime?: string
  plannedTrack?: string
  actualTrack?: string
}

interface NsStop {
  name?: string
  passing: boolean
}

interface NsMessage {
  head?: string
  text?: string
}

interface NsLeg {
  direction?: string
  cancelled: boolean
  origin: NsEndpoint
  destination: NsEndpoint
  product?: { displayName?: string; shortCategoryName?: string; longCategoryName?: string; number?: string }
  crowdForecast?: Crowd
  stops?: NsStop[]
  messages?: NsMessage[]
}

interface NsStation {
  id: { code: string }
  names: { long: string; medium?: string; short?: string; synonyms?: string[] }
  country: string
}

interface NsTrip {
  uid: string
  plannedDurationInMinutes?: number
  actualDurationInMinutes?: number
  transfers: number
  status: string
  primaryMessage?: { title: string; message?: NsMessage }
  messages?: NsMessage[]
  legs: NsLeg[]
  crowdForecast?: Crowd
  punctuality?: number
  productFare?: { priceInCents?: number }
  shareUrl?: { uri: string }
}

export function defaultRoute(): Route {
  const prefs = getPreferenceValues<Preferences>()
  return {
    from: prefs.fromStation?.trim().toUpperCase() || "TB",
    to: prefs.toStation?.trim().toUpperCase() || "EHV",
  }
}

async function nsRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  await takeRequestSlot()
  const apiKey = getPreferenceValues<Preferences>().apiKey.trim()
  const query = new URLSearchParams(params).toString()
  const res = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ""}`, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey, "Cache-Control": "no-cache" },
  })

  if (!res.ok) {
    if (res.status === 429) {
      await backOff(res.headers.get("Retry-After"))
      throw new RateLimitError("NS is rate limiting requests; try again in a minute")
    }
    const body = (await res.json().catch(() => null)) as { message?: string; errors?: { message?: string }[] } | null
    if (res.status === 401) throw new NsApiError("NS rejected the API key — check it in the extension preferences", 401)
    throw new NsApiError(body?.errors?.[0]?.message ?? body?.message ?? `NS API returned ${res.status}`, res.status)
  }

  return (await res.json()) as T
}

// Serves cached data while it's fresh, and falls back to it when the request is throttled or fails.
// Only a rejected request (bad key, unknown station) surfaces as an error.
async function cachedRequest<T>(
  key: string,
  freshMs: number,
  load: () => Promise<T>,
): Promise<Cached<T> & { staleReason?: string }> {
  const cached = await readCache<T>(key)
  if (cached && Date.now() - cached.fetchedAt < freshMs) return cached
  try {
    const value = await load()
    await writeCache(key, value)
    return { fetchedAt: Date.now(), value }
  } catch (error) {
    const rejected = error instanceof NsApiError && error.status >= 400 && error.status < 500
    if (!cached || rejected) throw error
    return { ...cached, staleReason: error instanceof Error ? error.message : String(error) }
  }
}

// `force` is a manual refresh: it may bypass the freshness window, but not within 15 seconds of the last fetch.
export async function fetchTrips(from: string, to: string, force = false): Promise<TripsResult> {
  const result = await cachedRequest(`trips:${from}:${to}`, force ? TRIPS_FORCED_FRESH_MS : TRIPS_FRESH_MS, async () => {
    try {
      const { trips } = await nsRequest<{ trips: NsTrip[] }>("/reisinformatie-api/api/v3/trips", {
        fromStation: from,
        toStation: to,
      })
      return trips.filter((trip) => trip.legs.length > 0).map(toTrip)
    } catch (error) {
      if (error instanceof NsApiError && error.status === 400) {
        throw new NsApiError(`NS couldn't plan ${from} → ${to}; check the station codes`, 400)
      }
      throw error
    }
  })
  return { trips: upcoming(result.value), fetchedAt: new Date(result.fetchedAt), staleReason: result.staleReason }
}

export async function fetchStations(): Promise<Station[]> {
  const result = await cachedRequest("stations", STATIONS_FRESH_MS, async () => {
    const { payload } = await nsRequest<{ payload: NsStation[] }>("/nsapp-stations/v3")
    return payload.map(toStation).sort((a, b) => a.name.localeCompare(b.name, "nl"))
  })
  return result.value
}

// NS returns a few trips from before `now` for context; drop the ones that already left.
function upcoming(trips: TrainTrip[]): TrainTrip[] {
  const now = Date.now()
  const remaining = trips.filter((trip) => trip.departure.actual.getTime() >= now - 30_000)
  return remaining.length > 0 ? remaining : trips
}

function toStation(station: NsStation): Station {
  const { long, medium, short, synonyms = [] } = station.names
  return {
    code: station.id.code,
    name: long,
    country: station.country,
    keywords: [...new Set([station.id.code, medium, short, ...synonyms].filter((name): name is string => Boolean(name)))],
  }
}

function toTrip(trip: NsTrip): TrainTrip {
  const legs = trip.legs.map(toLeg)
  const messages = [trip.primaryMessage?.title, ...(trip.messages ?? []).map(messageText), ...trip.legs.flatMap((leg) => (leg.messages ?? []).map(messageText))]
  return {
    id: trip.uid,
    departure: legs[0].departure,
    arrival: legs[legs.length - 1].arrival,
    durationMinutes: trip.actualDurationInMinutes ?? trip.plannedDurationInMinutes ?? 0,
    transfers: trip.transfers,
    status: trip.status,
    cancelled: trip.status === "CANCELLED" || legs.some((leg) => leg.cancelled),
    crowd: trip.crowdForecast ?? "UNKNOWN",
    punctuality: trip.punctuality,
    priceInCents: trip.productFare?.priceInCents,
    shareUrl: trip.shareUrl?.uri,
    messages: [...new Set(messages.filter((text): text is string => Boolean(text)))],
    legs,
  }
}

function toLeg(leg: NsLeg): TrainLeg {
  const product = leg.product
  return {
    product: [product?.longCategoryName ?? product?.displayName, product?.number].filter(Boolean).join(" ") || "Train",
    category: product?.shortCategoryName ?? product?.displayName ?? "",
    direction: leg.direction,
    departure: toStopTime(leg.origin),
    arrival: toStopTime(leg.destination),
    cancelled: leg.cancelled,
    crowd: leg.crowdForecast ?? "UNKNOWN",
    // stops includes the leg's own origin and destination.
    intermediateStops: (leg.stops ?? [])
      .slice(1, -1)
      .filter((stop) => !stop.passing && stop.name)
      .map((stop) => stop.name as string),
  }
}

function toStopTime(endpoint: NsEndpoint): StopTime {
  const planned = new Date(endpoint.plannedDateTime ?? endpoint.actualDateTime ?? Date.now())
  const actual = endpoint.actualDateTime ? new Date(endpoint.actualDateTime) : planned
  const track = endpoint.actualTrack ?? endpoint.plannedTrack
  return {
    station: endpoint.name ?? "",
    planned,
    actual,
    delayMinutes: Math.round((actual.getTime() - planned.getTime()) / 60_000),
    track,
    trackChanged: Boolean(endpoint.actualTrack && endpoint.plannedTrack && endpoint.actualTrack !== endpoint.plannedTrack),
  }
}

function messageText(message: NsMessage): string | undefined {
  return message.head ?? message.text
}
