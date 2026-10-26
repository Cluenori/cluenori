import { calendarDayOf, ComponentKey } from "@cluenori/foundation"
import { PersonNotFound } from "@cluenori/signals"
import { AsyncResult } from "effect/reactivity"
import { HeartPulseIcon, UserSearchIcon } from "lucide-react"
import { useState } from "react"

import { cohortRowsOf, healthRowsOf, peopleNowOf, personDaysOf } from "@/app-facts"
import { KitCard, KitColumn, KitGroup, KitSample } from "@/pages/kit-section"
import {
  sampleCohorts,
  sampleFeatures,
  sampleHealth,
  sampleInstallations,
  sampleKeys,
  samplePeriod,
  samplePersonDays,
  samplePolicy,
  sampleTimeline,
  sampleUsage,
  sampleUsageSinceRecently,
} from "@/sample/sample-apps"
import { AppsStart, ReleasesInUse, UsageTotals } from "@/views/app-usage"
import { BarRows } from "@/views/bar-rows"
import { FeatureTable } from "@/views/feature-table"
import { HealthList } from "@/views/health-list"
import { HealthTable } from "@/views/health-table"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { PeopleCounters } from "@/views/people-counters"
import { InstallationList, Timeline } from "@/views/person-views"
import { RetentionGrid } from "@/views/retention-grid"
import { SdkKeys } from "@/views/sdk-keys"
import { Button } from "@/views/ui/button"
import { VersionPolicyDialog, VersionPolicySummary } from "@/views/version-policy"

const ios = ComponentKey.make("notes-ios")
const purple = "var(--purple)"
const colorOfApp = () => purple
const noop = () => undefined
const asOf = samplePeriod.to
const worse = sampleHealth.find((each) => each.verdict === "worse")
const first = sampleHealth.find((each) => each.verdict === "first")
const partial = sampleHealth.find((each) => each.verdict === "better")

/** The version policy dialog, opened from a button, as the analytics page opens it. */
function PolicyDialogSample() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change…
      </Button>
      {open && (
        <VersionPolicyDialog
          component={ios}
          current={samplePolicy}
          open
          onOpenChange={setOpen}
          saving={false}
          refusal={undefined}
          onSave={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The analytics views on sample answers about notes-ios, in each state they have: no app yet, a
 * full answer, a partial one (measures the API left out, days not counted yet), loading and failing.
 */
export function KitAnalytics() {
  return (
    <KitGroup
      id="analytics"
      title="Analytics"
      description="How apps are used and how healthy each release is, their SDK keys and version policies. On sample data, in every state: none yet, full, partial, loading, failing."
    >
      <KitCard
        title="App health"
        wide
        description="Releases against the release before each, one of every verdict; crashes unknown until MetricKit reports."
        files={["health-list.tsx", "app-facts.ts"]}
      >
        <HealthList releases={sampleHealth} asOf={asOf} colorOf={colorOfApp} linkOf={() => ({ page: "kit" })} />
        <KitSample label="None in the period">
          <HealthList releases={[]} asOf={asOf} colorOf={colorOfApp} linkOf={() => ({ page: "kit" })} />
        </KitSample>
      </KitCard>
      <KitColumn>
        <KitCard
          title="No app yet"
          description="The page of a project no app sends to, which says what to do."
          files={["app-usage.tsx"]}
        >
          <AppsStart periodText="the last 30 days" deployment="https://cluenori.example.com" />
        </KitCard>
        <KitCard
          title="People"
          description="Daily, weekly and monthly people on the latest whole UTC day against a week before, each with its days, and the period's totals. Partial: an app that first sent 12 days ago, its month unknown, its earlier days hatched."
          files={["people-counters.tsx", "app-usage.tsx", "app-facts.ts"]}
        >
          <KitSample label="Full">
            <div className="flex w-full flex-col gap-4">
              <PeopleCounters now={peopleNowOf(sampleUsage, samplePeriod)} color={purple} />
              <UsageTotals usage={sampleUsage} period={samplePeriod} periodText="the last 30 days" />
            </div>
          </KitSample>
          <KitSample label="Partial">
            <div className="flex w-full flex-col gap-4">
              <PeopleCounters now={peopleNowOf(sampleUsageSinceRecently, samplePeriod)} color={purple} />
              <UsageTotals usage={sampleUsageSinceRecently} period={samplePeriod} periodText="the last 30 days" />
            </div>
          </KitSample>
        </KitCard>
        <KitCard
          title="Releases in use"
          description="Each release's share of the period's people."
          files={["app-usage.tsx"]}
        >
          <ReleasesInUse usage={sampleUsage} colorOfComponent={colorOfApp} />
        </KitCard>
        <KitCard
          title="Retention"
          description="Weekly cohorts, each week's share written in its cell; this week, so far, outlined."
          files={["retention-grid.tsx"]}
        >
          <RetentionGrid rows={cohortRowsOf(sampleCohorts)} label="Sample retention" color={purple} />
          <KitSample label="One cohort, the first week">
            <div className="w-full">
              <RetentionGrid rows={cohortRowsOf(sampleCohorts.slice(-1))} label="One cohort" color={purple} />
            </div>
          </KitSample>
        </KitCard>
        <KitCard
          title="Loading and failing"
          description="Every answer's first and failed states, as panels show them."
          files={["loaded.tsx"]}
        >
          <Panel icon={HeartPulseIcon} title="App health" subtitle="Loading">
            <Loaded result={AsyncResult.initial(true)}>{() => null}</Loaded>
          </Panel>
          <Panel icon={UserSearchIcon} title="user-0000" subtitle="A user ID the apps never sent">
            <Loaded result={AsyncResult.fail(new PersonNotFound())}>{() => null}</Loaded>
          </Panel>
        </KitCard>
      </KitColumn>
      <KitColumn>
        {worse !== undefined && first !== undefined && partial !== undefined && (
          <KitCard
            title="A release's app health"
            description="Each measure beside the release before; worse in yellow. Partial: the release before sent no memory, unknown. First: nothing to compare with."
            files={["health-table.tsx", "app-facts.ts"]}
          >
            <HealthTable rows={healthRowsOf(worse)} release={worse.release.release} previous={worse.release.previous} />
            <KitSample label="Partial">
              <div className="w-full">
                <HealthTable
                  rows={healthRowsOf(partial).slice(8, 12)}
                  release={partial.release.release}
                  previous={partial.release.previous}
                />
              </div>
            </KitSample>
            <KitSample label="First">
              <div className="w-full">
                <HealthTable
                  rows={healthRowsOf(first).slice(0, 4)}
                  release={first.release.release}
                  previous={undefined}
                />
              </div>
            </KitSample>
          </KitCard>
        )}
        <KitCard
          title="Features"
          description="Use by feature key; memory not measured in one, and what the app marked with no feature."
          files={["feature-table.tsx"]}
        >
          <FeatureTable rows={sampleFeatures} people={sampleUsage.people} color={purple} />
        </KitCard>
        <KitCard
          title="A person"
          description="Their installations, the days they were active, and what they did, newest first."
          files={["person-views.tsx", "app-facts.ts"]}
        >
          <InstallationList installations={sampleInstallations} asOf={asOf} colorOf={colorOfApp} />
          <BarRows
            rowHeight={48}
            label="Sample sessions by day."
            rows={[
              {
                label: "Sessions",
                color: purple,
                values: personDaysOf(samplePersonDays, calendarDayOf(asOf)).values,
              },
            ]}
            ticks={[]}
            timeOf={() => ""}
          />
          <Timeline entries={sampleTimeline} />
        </KitCard>
        <KitCard
          title="SDK keys"
          description="None yet; the key builds carry now, with a revoked one folded; issuing, and what failed."
          files={["sdk-keys.tsx", "copy-button.tsx"]}
        >
          <KitSample label="None yet">
            <SdkKeys component={ios} keys={[]} issuing={false} onIssue={noop} onRevoke={noop} />
          </KitSample>
          <KitSample label="Active and revoked">
            <SdkKeys
              component={ios}
              keys={sampleKeys}
              issuing={false}
              {...(sampleKeys[0] === undefined ? {} : { justIssued: sampleKeys[0].key })}
              onIssue={noop}
              onRevoke={noop}
            />
          </KitSample>
          <KitSample label="Issuing, after a failure">
            <SdkKeys
              component={ios}
              keys={sampleKeys}
              issuing
              problem="The API didn't answer. Check that Cluenori is running, then try again."
              onIssue={noop}
              onRevoke={noop}
            />
          </KitSample>
        </KitCard>
        <KitCard
          title="Version policy"
          description="None; one with its words; changing it."
          files={["version-policy.tsx"]}
        >
          <VersionPolicySummary policy={undefined} />
          <VersionPolicySummary policy={samplePolicy} />
          <PolicyDialogSample />
        </KitCard>
      </KitColumn>
    </KitGroup>
  )
}
