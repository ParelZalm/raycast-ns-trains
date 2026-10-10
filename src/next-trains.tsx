import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@raycast/api"
import { ComponentProps, useEffect, useState } from "react"
import { useCachedPromise } from "@raycast/utils"
import { TrainLeg, TrainTrip, fetchTrips } from "./api/ns"
import {
  crowdColor,
  crowdLabel,
  formatDelay,
  formatDuration,
  formatPrice,
  formatStopTime,
  formatTime,
  formatTrack,
  minutesUntil,
  statusLabel,
} from "./format"
import { useRoute } from "./route"
import { StationPicker } from "./station-picker"

export default function Command() {
  const { route, isLoading: routeLoading, isDefault, setRoute, resetRoute } = useRoute()
  const [showingDetail, setShowingDetail] = useState(false)
  const { data, isLoading, error, mutate } = useCachedPromise(fetchTrips, [route.from, route.to], {
    execute: !routeLoading,
  })
  const trips = data?.trips ?? []

  useEffect(() => {
    if (!data?.staleReason) return
    showToast({ style: Toast.Style.Failure, title: `Showing trains from ${formatTime(data.fetchedAt)}`, message: data.staleReason })
  }, [data?.staleReason, data?.fetchedAt])

  const first = trips[0]
  const routeTitle = first ? `${first.departure.station} → ${first.arrival.station}` : `${route.from} → ${route.to}`
  const refresh = () => mutate(fetchTrips(route.from, route.to, true), { shouldRevalidateAfter: false })

  // Picking the station at the other end of the route swaps the direction instead of planning X → X.
  const routeActions = (
    <ActionPanel.Section title="Route">
      <Action
        title="Swap Direction"
        icon={Icon.Switch}
        shortcut={{ modifiers: ["cmd"], key: "s" }}
        onAction={() => setRoute({ from: route.to, to: route.from })}
      />
      <Action.Push
        title="Change Departure Station"
        icon={Icon.Pin}
        shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
        target={
          <StationPicker
            title="Departure Station"
            current={route.from}
            onPick={(code) => setRoute({ from: code, to: code === route.to ? route.from : route.to })}
          />
        }
      />
      <Action.Push
        title="Change Destination"
        icon={Icon.Flag}
        shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
        target={
          <StationPicker
            title="Destination"
            current={route.to}
            onPick={(code) => setRoute({ from: code === route.from ? route.to : route.from, to: code })}
          />
        }
      />
      {!isDefault && (
        <Action
          title="Reset to Default Route"
          icon={Icon.House}
          shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
          onAction={resetRoute}
        />
      )}
    </ActionPanel.Section>
  )

  return (
    <List
      isLoading={isLoading || routeLoading}
      isShowingDetail={showingDetail && trips.length > 0}
      navigationTitle={routeTitle}
    >
      {error && trips.length === 0 ? (
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title="Couldn't load trains"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={refresh} />
              {routeActions}
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title={routeTitle} subtitle={data ? `Updated ${formatTime(data.fetchedAt)}` : undefined}>
          {trips.map((trip) => (
            <TripItem
              key={trip.id}
              trip={trip}
              showingDetail={showingDetail}
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    {trip.shareUrl && <Action.OpenInBrowser title="Open in NS Planner" url={trip.shareUrl} />}
                    <Action
                      title={showingDetail ? "Hide Details" : "Show Details"}
                      icon={Icon.Sidebar}
                      shortcut={{ modifiers: ["cmd"], key: "d" }}
                      onAction={() => setShowingDetail(!showingDetail)}
                    />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={{ modifiers: ["cmd"], key: "r" }}
                      onAction={refresh}
                    />
                    <Action.CopyToClipboard
                      title="Copy Trip Summary"
                      content={tripSummary(trip)}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    />
                  </ActionPanel.Section>
                  {routeActions}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  )
}

function TripItem({ trip, showingDetail, actions }: { trip: TrainTrip; showingDetail: boolean; actions: ComponentProps<typeof List.Item>["actions"] }) {
  const status = statusLabel(trip)
  const delay = formatDelay(trip.departure)
  const track = trip.departure.track
  const categories = [...new Set(trip.legs.map((leg) => leg.category).filter(Boolean))].join(" + ")
  const transfers = trip.transfers === 0 ? "direct" : `${trip.transfers} transfer${trip.transfers > 1 ? "s" : ""}`

  const accessories: List.Item.Accessory[] = showingDetail
    ? []
    : [
        ...(status ? [{ tag: { value: status, color: Color.Red } }] : []),
        ...(delay ? [{ tag: { value: delay, color: Color.Orange }, tooltip: `Planned ${formatTime(trip.departure.planned)}` }] : []),
        ...(track
          ? [
              {
                tag: { value: `Spoor ${track}`, color: trip.departure.trackChanged ? Color.Orange : Color.SecondaryText },
                tooltip: trip.departure.trackChanged ? "Platform changed" : undefined,
              },
            ]
          : []),
        { icon: { source: Icon.TwoPeople, tintColor: crowdColor[trip.crowd] }, tooltip: `Crowding: ${crowdLabel[trip.crowd]}` },
        { text: `in ${minutesUntil(trip.departure.actual)} min` },
      ]

  return (
    <List.Item
      icon={{ source: Icon.Train, tintColor: trip.cancelled ? Color.Red : delay ? Color.Orange : Color.Green }}
      title={`${formatTime(trip.departure.actual)} → ${formatTime(trip.arrival.actual)}`}
      subtitle={`${categories} · ${formatDuration(trip.durationMinutes)} · ${transfers}`}
      accessories={accessories}
      detail={<TripDetail trip={trip} />}
      actions={actions}
    />
  )
}

function TripDetail({ trip }: { trip: TrainTrip }) {
  const departureTrack = formatTrack(trip.departure)
  const arrivalTrack = formatTrack(trip.arrival)
  const markdown = [...trip.messages.map((message) => `> ⚠️ ${message}`), ...trip.legs.map(legMarkdown)].join("\n\n")

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Departure" text={formatStopTime(trip.departure)} />
          {departureTrack && <List.Item.Detail.Metadata.Label title="Departure Platform" text={departureTrack} />}
          <List.Item.Detail.Metadata.Label title="Arrival" text={formatStopTime(trip.arrival)} />
          {arrivalTrack && <List.Item.Detail.Metadata.Label title="Arrival Platform" text={arrivalTrack} />}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Duration" text={formatDuration(trip.durationMinutes)} />
          <List.Item.Detail.Metadata.Label title="Transfers" text={String(trip.transfers)} />
          <List.Item.Detail.Metadata.TagList title="Crowding">
            <List.Item.Detail.Metadata.TagList.Item text={crowdLabel[trip.crowd]} color={crowdColor[trip.crowd]} />
          </List.Item.Detail.Metadata.TagList>
          {trip.punctuality !== undefined && (
            <List.Item.Detail.Metadata.Label title="Punctuality" text={`${Math.round(trip.punctuality)}%`} />
          )}
          {trip.priceInCents !== undefined && (
            <List.Item.Detail.Metadata.Label title="Fare (2nd class, full)" text={formatPrice(trip.priceInCents)} />
          )}
        </List.Item.Detail.Metadata>
      }
    />
  )
}

function legMarkdown(leg: TrainLeg): string {
  const heading = `### ${leg.cancelled ? "~~" : ""}${leg.product}${leg.direction ? ` → ${leg.direction}` : ""}${leg.cancelled ? "~~ (cancelled)" : ""}`
  const lines = [
    heading,
    `**${formatStopTime(leg.departure)}** ${leg.departure.station}${leg.departure.track ? ` · spoor ${leg.departure.track}` : ""}`,
    `**${formatStopTime(leg.arrival)}** ${leg.arrival.station}${leg.arrival.track ? ` · spoor ${leg.arrival.track}` : ""}`,
  ]
  if (leg.intermediateStops.length > 0) lines.push(`Via ${leg.intermediateStops.join(", ")}`)
  return lines.join("\n\n")
}

function tripSummary(trip: TrainTrip): string {
  const track = trip.departure.track ? ` (spoor ${trip.departure.track})` : ""
  const delay = formatDelay(trip.departure)
  return `${formatTime(trip.departure.actual)} ${trip.departure.station}${track} → ${formatTime(trip.arrival.actual)} ${trip.arrival.station}${delay ? ` · ${delay} min` : ""}`
}
