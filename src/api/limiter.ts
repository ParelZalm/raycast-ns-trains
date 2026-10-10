// Keeps the extension well under NS's unpublished API limits. Responses are reused while fresh, and all
// commands share one request budget through LocalStorage, so the menu bar and list never stack up calls.
import { LocalStorage } from "@raycast/api"

const MAX_REQUESTS_PER_MINUTE = 10
const DEFAULT_BACKOFF_SECONDS = 60
const LOG_KEY = "ns-request-log"
const BLOCKED_UNTIL_KEY = "ns-blocked-until"
const CACHE_PREFIX = "ns-cache:"

export class RateLimitError extends Error {}

export interface Cached<T> {
  fetchedAt: number
  value: T
}

export async function takeRequestSlot(): Promise<void> {
  const now = Date.now()
  const blockedUntil = Number((await LocalStorage.getItem<string>(BLOCKED_UNTIL_KEY)) ?? 0)
  if (blockedUntil > now) {
    throw new RateLimitError(`NS asked to slow down; retrying after ${new Date(blockedUntil).toLocaleTimeString("nl-NL")}`)
  }

  const recent = JSON.parse((await LocalStorage.getItem<string>(LOG_KEY)) ?? "[]").filter(
    (time: number) => time > now - 60_000,
  ) as number[]
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new RateLimitError(`More than ${MAX_REQUESTS_PER_MINUTE} NS requests in the last minute; try again shortly`)
  }
  await LocalStorage.setItem(LOG_KEY, JSON.stringify([...recent, now]))
}

export async function backOff(retryAfterHeader: string | null): Promise<void> {
  const seconds = Number(retryAfterHeader) || DEFAULT_BACKOFF_SECONDS
  await LocalStorage.setItem(BLOCKED_UNTIL_KEY, String(Date.now() + seconds * 1000))
}

export async function readCache<T>(key: string): Promise<Cached<T> | undefined> {
  const raw = await LocalStorage.getItem<string>(CACHE_PREFIX + key)
  return raw ? (JSON.parse(raw, reviveDates) as Cached<T>) : undefined
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  await LocalStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ fetchedAt: Date.now(), value }))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value
}
