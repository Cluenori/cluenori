import { DateTime } from "effect"
import { CopyIcon, KeyRoundIcon, SearchIcon } from "lucide-react"
import { Fragment, useState } from "react"
import type { DateRange } from "react-day-picker"

import { count, duration, share } from "@/lib/format"
import { KitCard, KitColumn, KitGroup, KitSample } from "@/pages/kit-section"
import { operationTable, sampleComponents } from "@/sample/sample-project"
import { Calendar } from "@/views/ui/calendar"
import { Checkbox } from "@/views/ui/checkbox"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/views/ui/combobox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/views/ui/field"
import { Input } from "@/views/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/views/ui/input-group"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/views/ui/input-otp"
import { Kbd } from "@/views/ui/kbd"
import { NativeSelect, NativeSelectOption } from "@/views/ui/native-select"
import { RadioGroup, RadioGroupItem } from "@/views/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/views/ui/select"
import { Slider } from "@/views/ui/slider"
import { Switch } from "@/views/ui/switch"
import { Textarea } from "@/views/ui/textarea"

const releaseGroups = [
  { component: "folio-api", versions: ["2.14.0+412", "2.13.2+398", "2.13.1+390"] },
  { component: "folio-ios", versions: ["2.14.0+412", "2.13.0+386"] },
] as const

const releaseItems = releaseGroups.flatMap((group) =>
  group.versions.map((version) => ({ value: `${group.component}@${version}`, label: `${group.component} ${version}` })),
)

const operations = operationTable("24h").rows.map((row) => row.operation)

// react-day-picker takes JavaScript dates. These are whole days, so they are built at midnight UTC
// and the calendars below count days in UTC: the same days show in every time zone.
const utcDay = (isoDay: string) => DateTime.toDateUtc(DateTime.makeUnsafe(isoDay))
const today = utcDay("2026-10-20")
const dayMillis = 86_400_000

// A slider gives one number or several; these keep several.
const valuesOf = (value: number | ReadonlyArray<number>) => (typeof value === "number" ? [value] : [...value])

// Several choices, shown as chips in the field.
function ComponentsField() {
  const anchor = useComboboxAnchor()
  return (
    <Field>
      <FieldLabel htmlFor="kit-components">Components</FieldLabel>
      <Combobox items={sampleComponents.map((entry) => entry.key)} multiple defaultValue={["folio-api", "folio-ios"]}>
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(values: ReadonlyArray<string>) => (
              <>
                {values.map((value) => (
                  <ComboboxChip key={value}>{value}</ComboboxChip>
                ))}
                <ComboboxChipsInput id="kit-components" placeholder={values.length > 0 ? "" : "Add a component"} />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Nothing matches.</ComboboxEmpty>
          <ComboboxList>
            {(component: string) => (
              <ComboboxItem key={component} value={component}>
                {component}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>Charts count only these.</FieldDescription>
    </Field>
  )
}

function CalendarSamples() {
  const [day, setDay] = useState<Date | undefined>(today)
  const [range, setRange] = useState<DateRange | undefined>({ from: utcDay("2026-10-13"), to: today })
  const days =
    range?.from !== undefined && range.to !== undefined
      ? Math.round((range.to.getTime() - range.from.getTime()) / dayMillis) + 1
      : undefined

  return (
    <div className="flex flex-wrap gap-6">
      <KitSample label="One day" className="flex-col items-start">
        <Calendar
          mode="single"
          selected={day}
          onSelect={setDay}
          timeZone="UTC"
          today={today}
          defaultMonth={today}
          className="rounded-xl ring-1 ring-foreground/10"
        />
        <span className="text-xs text-muted-foreground">
          {day === undefined ? "No day chosen." : "The day of the release."}
        </span>
      </KitSample>
      <KitSample label="A range of days" className="flex-col items-start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          timeZone="UTC"
          today={today}
          defaultMonth={today}
          className="rounded-xl ring-1 ring-foreground/10"
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {days === undefined ? "Pick the first and the last day." : `${count(days)} days chosen.`}
        </span>
      </KitSample>
    </div>
  )
}

/** Fields, choices and pickers, with their labels, descriptions and errors. */
export function KitForms() {
  const [sampleRate, setSampleRate] = useState([25])
  const [slowRange, setSlowRange] = useState([100, 1_000])
  const [code, setCode] = useState("418")

  return (
    <KitGroup
      id="forms"
      title="Forms"
      description="Fields with their labels, descriptions and errors, and every way to choose something."
    >
      <KitColumn>
        <KitCard
          title="Text fields"
          description="A label above, a description below, and an error that says how to fix it."
          files={["field.tsx", "input.tsx", "input-group.tsx", "textarea.tsx", "label.tsx"]}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="kit-project-name">Project name</FieldLabel>
              <Input id="kit-project-name" defaultValue="folio" />
              <FieldDescription>Shown in the sidebar and in every link to the project.</FieldDescription>
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="kit-component-name">Component name</FieldLabel>
              <Input id="kit-component-name" defaultValue="Folio API" aria-invalid />
              <FieldError>Use lowercase letters, numbers and dashes, such as folio-api.</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-ingest-key">Ingest key</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <KeyRoundIcon />
                </InputGroupAddon>
                <InputGroupInput id="kit-ingest-key" readOnly value="ck_live_••••••••••••3f9a" />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="Copy the ingest key">
                    <CopyIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>folio-api sends its traces, logs and metrics with it.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-endpoint-url">Where traces go</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>https://</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput id="kit-endpoint-url" placeholder="your-cluenori.example/otlp/v1/traces" />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-search">Search</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput id="kit-search" placeholder="Find a log line" />
                <InputGroupAddon align="inline-end">
                  <Kbd>/</Kbd>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-release-notes">What changed</FieldLabel>
              <Textarea
                id="kit-release-notes"
                defaultValue="Exports run in batches of 500 rows again, so a large export no longer holds a database connection for minutes."
              />
              <FieldDescription>Shown next to the release on every chart.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-disabled">Project key</FieldLabel>
              <Input id="kit-disabled" defaultValue="folio" disabled />
              <FieldDescription>It is part of every link, so it can't change.</FieldDescription>
            </Field>
          </FieldGroup>
        </KitCard>
        <KitCard
          title="Switches, checkboxes and radios"
          description="Settings that are on or off, and one choice among a few."
          files={["checkbox.tsx", "radio-group.tsx", "switch.tsx"]}
        >
          <FieldSet>
            <FieldLegend variant="label">Tell me about</FieldLegend>
            <FieldDescription>By email and in the app.</FieldDescription>
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox id="kit-notify-new" defaultChecked />
                <FieldLabel htmlFor="kit-notify-new" className="font-normal">
                  New kinds of errors
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="kit-notify-ongoing" defaultChecked />
                <FieldLabel htmlFor="kit-notify-ongoing" className="font-normal">
                  Errors that keep happening
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="kit-notify-weekly" />
                <FieldLabel htmlFor="kit-notify-weekly" className="font-normal">
                  A summary every Monday
                </FieldLabel>
              </Field>
              <Field orientation="horizontal" data-disabled>
                <Checkbox id="kit-notify-billing" disabled />
                <FieldLabel htmlFor="kit-notify-billing" className="font-normal">
                  Billing, which only owners get
                </FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Count the same error once when it has</FieldLegend>
            <RadioGroup defaultValue="type-and-place">
              <Field orientation="horizontal">
                <RadioGroupItem value="type-and-place" id="kit-group-place" />
                <FieldLabel htmlFor="kit-group-place" className="font-normal">
                  The same type and place in the code
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="message" id="kit-group-message" />
                <FieldLabel htmlFor="kit-group-message" className="font-normal">
                  The same message
                </FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>
          <FieldGroup className="gap-3">
            <FieldLabel htmlFor="kit-keep-exports">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Keep every export</FieldTitle>
                  <FieldDescription>For 90 days, with personal data removed.</FieldDescription>
                </FieldContent>
                <Switch id="kit-keep-exports" defaultChecked />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="kit-share-staging">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Count staging too</FieldTitle>
                  <FieldDescription>Its runs are added to production's.</FieldDescription>
                </FieldContent>
                <Switch id="kit-share-staging" />
              </Field>
            </FieldLabel>
            <Field orientation="horizontal">
              <Switch id="kit-small-switch" size="sm" defaultChecked />
              <FieldLabel htmlFor="kit-small-switch" className="font-normal">
                A small switch
              </FieldLabel>
            </Field>
          </FieldGroup>
        </KitCard>
      </KitColumn>
      <KitColumn>
        <KitCard
          title="Choosing one of many"
          description="A list to pick from, the browser's own, and one to search."
          files={["select.tsx", "native-select.tsx", "combobox.tsx"]}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="kit-release">Release</FieldLabel>
              <Select items={releaseItems} defaultValue="folio-api@2.14.0+412">
                <SelectTrigger id="kit-release" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {releaseGroups.map((group, index) => (
                    <Fragment key={group.component}>
                      {index > 0 && <SelectSeparator />}
                      <SelectGroup>
                        <SelectLabel>{group.component}</SelectLabel>
                        {group.versions.map((version) => (
                          <SelectItem key={version} value={`${group.component}@${version}`}>
                            {version}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </Fragment>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Charts mark when it shipped.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-environment">Environment</FieldLabel>
              <NativeSelect id="kit-environment" defaultValue="production" className="w-full">
                <NativeSelectOption value="production">production</NativeSelectOption>
                <NativeSelectOption value="staging">staging</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-operation">Operation</FieldLabel>
              <Combobox items={operations}>
                <ComboboxInput id="kit-operation" placeholder="Find an operation" className="w-full" />
                <ComboboxContent>
                  <ComboboxEmpty>Nothing matches.</ComboboxEmpty>
                  <ComboboxList>
                    {(operation: string) => (
                      <ComboboxItem key={operation} value={operation}>
                        <code className="font-mono text-xs">{operation}</code>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <FieldDescription>Type part of a path, such as export.</FieldDescription>
            </Field>
            <ComponentsField />
          </FieldGroup>
        </KitCard>
        <KitCard title="Code" description="A one-time code, typed or pasted." files={["input-otp.tsx"]}>
          <Field>
            <FieldLabel htmlFor="kit-code">Sign-in code</FieldLabel>
            <InputOTP id="kit-code" maxLength={6} value={code} onChange={setCode}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <FieldDescription>We sent it to your email. It works for 10 minutes.</FieldDescription>
          </Field>
        </KitCard>
        <KitCard title="Slider" description="A number in a range, or a range itself." files={["slider.tsx"]}>
          <Field>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="kit-sample-rate">Traces to keep</FieldLabel>
              <span className="text-sm text-muted-foreground tabular-nums">{share(sampleRate[0] ?? 0, 100)}</span>
            </div>
            <Slider
              id="kit-sample-rate"
              value={sampleRate}
              onValueChange={(value) => setSampleRate(valuesOf(value))}
              max={100}
              step={5}
            />
            <FieldDescription>Every failed run is kept, whatever this says.</FieldDescription>
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="kit-slow">Fine, then slow</FieldLabel>
              <span className="text-sm text-muted-foreground tabular-nums">
                {duration(slowRange[0] ?? 0)} and {duration(slowRange[1] ?? 0)}
              </span>
            </div>
            <Slider
              id="kit-slow"
              value={slowRange}
              onValueChange={(value) => setSlowRange(valuesOf(value))}
              max={3_000}
              step={50}
            />
            <FieldDescription>Faster than the first is fast; slower than the second is slow.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="kit-slider-disabled">Disabled</FieldLabel>
            <Slider id="kit-slider-disabled" defaultValue={[60]} disabled />
          </Field>
        </KitCard>
        <KitCard title="Calendar" description="One day, or the days between two." files={["calendar.tsx"]}>
          <CalendarSamples />
        </KitCard>
      </KitColumn>
    </KitGroup>
  )
}
