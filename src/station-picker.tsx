import { Action, ActionPanel, Icon, List, useNavigation } from "@raycast/api"
import { useCachedPromise } from "@raycast/utils"
import { useState } from "react"
import { Station, fetchStations } from "./api/ns"

export function StationPicker({
  title,
  current,
  onPick,
}: {
  title: string
  current: string
  onPick: (code: string) => void
}) {
  const { data: stations = [], isLoading } = useCachedPromise(fetchStations)
  const [searchText, setSearchText] = useState("")
  const { pop } = useNavigation()
  const matches = searchStations(stations, searchText)
  const domestic = matches.filter((station) => station.country === "NL")
  const abroad = matches.filter((station) => station.country !== "NL")

  const item = (station: Station) => (
    <List.Item
      key={station.code}
      icon={station.code === current ? Icon.CheckCircle : Icon.Train}
      title={station.name}
      subtitle={station.code}
      accessories={station.country === "NL" ? [] : [{ tag: station.country }]}
      actions={
        <ActionPanel>
          <Action
            title={`Choose ${station.name}`}
            icon={Icon.Check}
            onAction={() => {
              onPick(station.code)
              pop()
            }}
          />
        </ActionPanel>
      }
    />
  )

  return (
    <List
      isLoading={isLoading}
      navigationTitle={title}
      searchBarPlaceholder="Search station name or code"
      filtering={false}
      onSearchTextChange={setSearchText}
    >
      <List.Section title="Netherlands">{domestic.map(item)}</List.Section>
      <List.Section title="Abroad">{abroad.map(item)}</List.Section>
    </List>
  )
}

// Raycast's built-in fuzzy filter matches "eind" to "Deinum"; stations need plain substring matching.
// Exact code matches rank first, then names starting with the query, then the rest.
function searchStations(stations: Station[], searchText: string): Station[] {
  const query = normalize(searchText.trim())
  if (!query) return stations
  const rank = (station: Station) => {
    if (normalize(station.code) === query) return 0
    const names = [station.name, ...station.keywords].map(normalize)
    if (names.some((name) => name.startsWith(query))) return 1
    if (names.some((name) => name.includes(query))) return 2
    return undefined
  }
  return stations
    .map((station) => ({ station, rank: rank(station) }))
    .filter((match): match is { station: Station; rank: number } => match.rank !== undefined)
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.station)
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}
