import { slowerOf } from "@cluenori/signals"

import { KitCard, KitColumn, KitGroup } from "@/pages/kit-section"
import { colorOf, slowerMeaning } from "@/project-facts"
import {
  operationTable,
  errorGroups,
  networkCalls,
  sampleComponents,
  sampleProject,
  screenTable,
} from "@/sample/sample-project"
import { ByRelease, Trail } from "@/views/app-evidence"
import { NetworkTable } from "@/views/network-table"
import { ScreenTable } from "@/views/screen-table"

const components = sampleComponents.map((component) => component.key)
const colorOfComponent = (component: string) => colorOf(component, components)
const backend = "folio-api"
const app = "folio-ios"

const lastDay = operationTable("24h").rows

const screens = screenTable(app, "24h").map((row) => {
  const slower = slowerOf(row)
  return slower === undefined ? row : { ...row, slower }
})

const calls = networkCalls(app, "24h").map((row) => {
  const served = lastDay.find((entry) => entry.operation === row.endpoint)
  return served === undefined ? row : { ...row, backendP95Ms: served.p95Ms }
})

const appError = errorGroups.find((group) => group.trail !== undefined)

/**
 * Views the pages will show once the public API carries their data: an app's screens and the calls
 * it makes, and what an app did before an error. They wait here, on sample data, so their design is
 * kept up as the theme changes.
 */
export function KitAhead() {
  return (
    <KitGroup
      id="ahead"
      title="Ahead of the API"
      description="Views waiting for data the API doesn't carry yet, from the apps' SDKs. On sample data."
    >
      <KitColumn>
        <KitCard
          title="Screens"
          description="An app's screens by how long they took to show, the most shown first."
          files={["screen-table.tsx"]}
        >
          <ScreenTable rows={screens} color={colorOfComponent(app)} heading="Screen" />
          <p className="text-sm text-muted-foreground">{slowerMeaning}</p>
        </KitCard>
        <KitCard
          title="Network calls"
          description="The backend's endpoints as the app saw them, with the backend's share of the time."
          files={["network-table.tsx"]}
        >
          <NetworkTable rows={calls} backendColor={colorOfComponent(backend)} linkOf={() => ({ page: "kit" })} />
        </KitCard>
      </KitColumn>
      <KitColumn>
        {appError?.trail !== undefined && (
          <KitCard
            title="An app's error"
            description="What the app did before it, and how it spreads over releases."
            files={["app-evidence.tsx"]}
          >
            <Trail trail={appError.trail} project={sampleProject} />
            <ByRelease releases={appError.releases} occurrences={appError.occurrences} />
          </KitCard>
        )}
      </KitColumn>
    </KitGroup>
  )
}
