import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@raycast/api"
import { ComponentProps, useEffect, useState } from "react"
import { useCachedPromise } from "@raycast/utils"
import { StopTime, TrainLeg, TrainTrip, fetchStations, fetchTrips } from "./api/ns"
import {
  crowdColor,
  crowdLabel,
  formatDelay,
  formatDuration,
  formatPrice,
  formatStock,
  formatStopTime,
  formatTime,
  formatTrack,
  minutesUntil,
  statusLabel,
} from "./format"
import { useRoute } from "./route"
import { useSplitFlap } from "./split-flap"
import { StationPicker } from "./station-picker"
import { trainImageMarkdown } from "./train-image"

export default function Command() {
  const { route, isLoading: routeLoading, isDefault, setRoute, resetRoute } = useRoute()
  const [showingDetail, setShowingDetail] = useState(false)
  const { data, isLoading, error, mutate } = useCachedPromise(fetchTrips, [route.from, route.to], {
    execute: !routeLoading,
  })
  const trips = data?.trips ?? []
  const flap = useSplitFlap(trips.map((trip) => ({ id: trip.id, text: tripTimes(trip) })))

  useEffect(() => {
    if (!data?.staleReason) return
    showToast({ style: Toast.Style.Failure, title: `Showing trains from ${formatTime(data.fetchedAt)}`, message: data.staleReason })
  }, [data?.staleReason, data?.fetchedAt])

  const first = trips[0]
  const routeTitle = first ? `${first.departure.station} → ${first.arrival.station}` : `${route.from} → ${route.to}`
  const { data: stations } = useCachedPromise(fetchStations)
  const shortName = (code: string) => stations?.find((station) => station.code === code)?.shortName ?? code
  // The detail pane leaves the section header too narrow for full names next to "Updated"; NS's short names fit.
  const sectionTitle = showingDetail && trips.length > 0 ? `${shortName(route.from)} → ${shortName(route.to)}` : routeTitle
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
        <List.Section title={sectionTitle} subtitle={data ? `Updated ${formatTime(data.fetchedAt)}` : undefined}>
          {trips.map((trip) => (
            <TripItem
              key={trip.id}
              trip={trip}
              showingDetail={showingDetail}
              title={flap(trip.id, tripTimes(trip))}
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

function TripItem({
  trip,
  showingDetail,
  title,
  actions,
}: {
  trip: TrainTrip
  showingDetail: boolean
  title: string
  actions: ComponentProps<typeof List.Item>["actions"]
}) {
  const status = statusLabel(trip)
  const delay = formatDelay(trip.departure)
  const track = trip.departure.track
  const stock = trip.legs[0].stock
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
        ...(stock
          ? [
              {
                tag: { value: `${stock.carriages} cars`, color: stock.shortened ? Color.Orange : Color.SecondaryText },
                tooltip: formatStock(stock),
              },
            ]
          : []),
        { icon: { source: Icon.TwoPeople, tintColor: crowdColor[trip.crowd] }, tooltip: `Crowding: ${crowdLabel[trip.crowd]}` },
        { text: `in ${minutesUntil(trip.departure.actual)} min` },
      ]

  return (
    <List.Item
      icon={{ source: Icon.Train, tintColor: trip.cancelled ? Color.Red : delay ? Color.Orange : Color.Green }}
      title={title}
      subtitle={`${categories} · ${formatDuration(trip.durationMinutes)} · ${transfers}`}
      accessories={accessories}
      detail={<TripDetail trip={trip} />}
      actions={actions}
    />
  )
}

// Raycast gives the metadata only the bottom of the pane, so it stays short enough not to scroll;
// times and platforms are already in the legs above it.
function TripDetail({ trip }: { trip: TrainTrip }) {
  const stock = trip.legs[0].stock
  const markdown = [...trip.messages.map((message) => `> ⚠️ ${message}`), ...trip.legs.map(legMarkdown)].join("\n\n")
  const transfers = trip.transfers === 0 ? "direct" : `${trip.transfers} transfer${trip.transfers > 1 ? "s" : ""}`
  const punctuality = trip.punctuality !== undefined ? `${Math.round(trip.punctuality)}% on time` : undefined

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          {stock && (
            <List.Item.Detail.Metadata.Label
              title="Train"
              text={formatStock(stock)}
              icon={stock.shortened ? { source: Icon.Warning, tintColor: Color.Orange } : undefined}
            />
          )}
          <List.Item.Detail.Metadata.Label
            title="Journey"
            text={[formatDuration(trip.durationMinutes), transfers, punctuality].filter(Boolean).join(" · ")}
          />
          <List.Item.Detail.Metadata.TagList title="Crowding">
            <List.Item.Detail.Metadata.TagList.Item text={crowdLabel[trip.crowd]} color={crowdColor[trip.crowd]} />
          </List.Item.Detail.Metadata.TagList>
          {trip.priceInCents !== undefined && (
            <List.Item.Detail.Metadata.Label title="Fare (2nd class)" text={formatPrice(trip.priceInCents)} />
          )}
        </List.Item.Detail.Metadata>
      }
    />
  )
}

function legMarkdown(leg: TrainLeg): string {
  const heading = `### ${leg.cancelled ? "~~" : ""}${leg.product}${leg.direction ? ` → ${leg.direction}` : ""}${leg.cancelled ? "~~ (cancelled)" : ""}`
  const lines = [heading, stopMarkdown(leg.departure), stopMarkdown(leg.arrival)]
  if (leg.intermediateStops.length > 0) lines.push(`Via ${leg.intermediateStops.join(", ")}`)
  const train = leg.stock && trainImageMarkdown(leg.stock)
  if (train) lines.push(train)
  return lines.join("\n\n")
}

function stopMarkdown(stop: StopTime): string {
  const track = formatTrack(stop)
  return `**${formatStopTime(stop)}** ${stop.station}${track ? ` · ${track}` : ""}`
}

function tripTimes(trip: TrainTrip): string {
  return `${formatTime(trip.departure.actual)} → ${formatTime(trip.arrival.actual)}`
}

function tripSummary(trip: TrainTrip): string {
  const track = trip.departure.track ? ` (spoor ${trip.departure.track})` : ""
  const delay = formatDelay(trip.departure)
  return `${formatTime(trip.departure.actual)} ${trip.departure.station}${track} → ${formatTime(trip.arrival.actual)} ${trip.arrival.station}${delay ? ` · ${delay} min` : ""}`
}
