import { Icon, LaunchType, MenuBarExtra, launchCommand, open } from "@raycast/api"
import { useCachedPromise } from "@raycast/utils"
import { TrainTrip, fetchTrips } from "./api/ns"
import { formatDelay, formatTime, statusLabel } from "./format"
import { useRoute } from "./route"

const openNextTrains = () => launchCommand({ name: "next-trains", type: LaunchType.UserInitiated })

export default function Command() {
  const { route, isLoading: routeLoading } = useRoute()
  const { data, isLoading, error } = useCachedPromise(fetchTrips, [route.from, route.to], { execute: !routeLoading })
  const trips = data?.trips ?? []
  const next = trips[0]

  return (
    <MenuBarExtra
      icon={Icon.Train}
      title={next ? menuBarTitle(next) : undefined}
      isLoading={isLoading || routeLoading}
      tooltip="Next NS train"
    >
      {error && <MenuBarExtra.Item title={`Couldn't load trains: ${error.message}`} icon={Icon.Warning} />}
      {data?.staleReason && (
        <MenuBarExtra.Item title={`Showing trains from ${formatTime(data.fetchedAt)}`} subtitle={data.staleReason} icon={Icon.Clock} />
      )}
      {next && (
        <MenuBarExtra.Section title={`${next.departure.station} → ${next.arrival.station}`}>
          {trips.slice(0, 6).map((trip) => (
            <MenuBarExtra.Item
              key={trip.id}
              title={`${formatTime(trip.departure.actual)} → ${formatTime(trip.arrival.actual)}`}
              subtitle={tripDetails(trip)}
              onAction={() => (trip.shareUrl ? open(trip.shareUrl) : openNextTrains())}
            />
          ))}
        </MenuBarExtra.Section>
      )}
      {next && next.messages.length > 0 && (
        <MenuBarExtra.Section title="Notices">
          {next.messages.map((message) => (
            <MenuBarExtra.Item key={message} title={message} icon={Icon.Warning} />
          ))}
        </MenuBarExtra.Section>
      )}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item title="Open Next Trains" icon={Icon.List} onAction={openNextTrains} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  )
}

function menuBarTitle(trip: TrainTrip): string {
  if (trip.cancelled) return `${formatTime(trip.departure.planned)} cancelled`
  const delay = formatDelay(trip.departure)
  const track = trip.departure.track ? ` · ${trip.departure.track}` : ""
  return `${formatTime(trip.departure.actual)}${delay ? ` ${delay}` : ""}${track}`
}

function tripDetails(trip: TrainTrip): string {
  const parts = [
    statusLabel(trip),
    formatDelay(trip.departure),
    trip.departure.track && `spoor ${trip.departure.track}${trip.departure.trackChanged ? "!" : ""}`,
    trip.legs.map((leg) => leg.category).filter(Boolean).join(" + "),
  ]
  return parts.filter(Boolean).join(" · ")
}
