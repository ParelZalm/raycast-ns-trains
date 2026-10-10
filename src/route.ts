import { LaunchType, launchCommand } from "@raycast/api"
import { useLocalStorage } from "@raycast/utils"
import { Route, defaultRoute } from "./api/ns"

// The chosen route lives in LocalStorage so the menu bar follows whatever the list shows.
// It's only stored while it differs from the default in the extension preferences.
export function useRoute() {
  const fallback = defaultRoute()
  const { value, setValue, removeValue, isLoading } = useLocalStorage<Route>("route")
  const route = value ?? fallback
  const isDefault = route.from === fallback.from && route.to === fallback.to

  async function setRoute(next: Route) {
    if (next.from === fallback.from && next.to === fallback.to) await removeValue()
    else await setValue(next)
    await refreshMenuBar()
  }

  return { route, isLoading, isDefault, setRoute, resetRoute: () => setRoute(fallback) }
}

async function refreshMenuBar() {
  // Throws when the menu bar command isn't activated; nothing to refresh then.
  await launchCommand({ name: "next-train-menu-bar", type: LaunchType.Background }).catch(() => undefined)
}
