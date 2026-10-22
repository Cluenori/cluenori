import type { Pairing, Phone, PhoneId } from "@cluenori/phones"
import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { CheckIcon, QrCodeIcon, SmartphoneIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"

import { ago, countryName, moment } from "@/lib/format"
import { phonesAtom, removePhoneAtom, startPairingAtom } from "@/project-data"
import { CopyButton } from "@/views/copy-button"
import { failureText, Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { QrCode } from "@/views/qr-code"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button } from "@/views/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"

// While a code is shown, the phones are asked for this often, so the page says when one has paired.
const askEvery = 3_000

const clockNow = () => DateTime.toEpochMillis(DateTime.nowUnsafe())

// The time, again every `every` milliseconds, or fixed while it is undefined.
const useNow = (every: number | undefined) => {
  const [now, setNow] = useState(clockNow)
  useEffect(() => {
    if (every === undefined) {
      return
    }
    const timer = window.setInterval(() => setNow(clockNow()), every)
    return () => window.clearInterval(timer)
  }, [every])
  return now
}

// 9:05: minutes and seconds left.
const minutesAndSeconds = (millis: number) => {
  const seconds = Math.max(0, Math.ceil(millis / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** A pairing's code, and how long it works, each second, until it expires. */
function ShownCode({ pairing, onNewCode }: { readonly pairing: Pairing; readonly onNewCode: () => void }) {
  const expiresAt = DateTime.toEpochMillis(pairing.expiresAt)
  const now = useNow(1_000)
  const expired = now >= expiresAt
  return (
    <div className="flex flex-col gap-6 px-5 py-6 sm:flex-row sm:items-start">
      <div className="relative w-56 shrink-0">
        <QrCode
          text={pairing.link}
          label="The pairing code, for the iPhone's Camera"
          className={expired ? "w-56 opacity-15" : "w-56"}
        />
        {expired && (
          <div className="absolute inset-0 grid place-items-center">
            <Button onClick={onNewCode}>Show a new code</Button>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] marker:text-muted-foreground">
          <li>Install Cluenori on the iPhone, from TestFlight.</li>
          <li>Open the Camera and point it at the code.</li>
          <li>Tap the Cluenori link that appears.</li>
        </ol>
        {expired ? (
          <p className="text-sm text-muted-foreground">This code has expired.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The code pairs one phone, for you, and works for{" "}
              <span className="font-mono text-foreground">{minutesAndSeconds(expiresAt - now)}</span> more.
            </p>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">On a simulator, paste the link into Safari instead:</p>
              <CopyButton text={pairing.link} label="Copy the link" className="self-start" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// What adding a phone shows: the phone that paired, why there is no code, or the code.
function AddPhoneBody({
  pairing,
  paired,
  onNewCode,
}: {
  readonly pairing: AsyncResult.AsyncResult<Pairing, unknown>
  readonly paired: Phone | undefined
  readonly onNewCode: () => void
}) {
  if (paired !== undefined) {
    return (
      <div className="flex items-center gap-3 px-5 py-6">
        <CheckIcon className="size-5 text-mint" />
        <p className="text-[15px]">Paired your {paired.modelName}. It shows your projects now.</p>
      </div>
    )
  }
  if (AsyncResult.isFailure(pairing)) {
    return (
      <div className="flex flex-col items-start gap-4 px-5 py-6">
        <p role="alert" className="text-[15px] text-failure">
          {failureText(pairing.cause)}
        </p>
        <Button variant="outline" onClick={onNewCode}>
          Try again
        </Button>
      </div>
    )
  }
  if (!AsyncResult.isSuccess(pairing)) {
    return (
      <p aria-busy className="px-5 py-6 text-sm text-muted-foreground">
        Making a code…
      </p>
    )
  }
  return <ShownCode key={pairing.value.link} pairing={pairing.value} onNewCode={onNewCode} />
}

/**
 * Adding a phone: the pairing link as a QR code, how long it works, and, once a phone has paired
 * with it, which one.
 */
function AddPhone({
  pairing,
  paired,
  onNewCode,
  onClose,
}: {
  readonly pairing: AsyncResult.AsyncResult<Pairing, unknown>
  /** The phone that paired since the code was shown, if one has. */
  readonly paired: Phone | undefined
  readonly onNewCode: () => void
  readonly onClose: () => void
}) {
  return (
    <Panel
      icon={QrCodeIcon}
      title="Add a phone"
      subtitle="Scan the code with the iPhone's Camera"
      action={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {paired === undefined ? "Cancel" : "Done"}
        </Button>
      }
    >
      <AddPhoneBody pairing={pairing} paired={paired} onNewCode={onNewCode} />
    </Panel>
  )
}

function RemovePhone({ phone }: { readonly phone: Phone }) {
  const [open, setOpen] = useState(false)
  const remove = useAtomSet(removePhoneAtom)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove this {phone.modelName}?</AlertDialogTitle>
          <AlertDialogDescription>Its key stops working at once. To use it again, add it again.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              remove(phone.id)
            }}
          >
            Remove the phone
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function PhoneTable({ phones, now }: { readonly phones: ReadonlyArray<Phone>; readonly now: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Phone</TableHead>
          <TableHead>iOS</TableHead>
          <TableHead>App</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead>Paired</TableHead>
          <TableHead className="pr-5">
            <span className="sr-only">Remove</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {phones.map((phone) => (
          <TableRow key={phone.id}>
            <TableCell className="pl-5 font-medium">{phone.modelName}</TableCell>
            <TableCell className="font-mono">{phone.systemVersion}</TableCell>
            <TableCell className="font-mono">{phone.appVersion}</TableCell>
            <TableCell>
              {phone.lastSeen === undefined ? (
                <span className="text-muted-foreground">Not yet</span>
              ) : (
                <span className="flex flex-col">
                  <span>{ago(DateTime.toEpochMillis(phone.lastSeen.at), now)}</span>
                  {(phone.lastSeen.address !== undefined || phone.lastSeen.country !== undefined) && (
                    <span className="text-muted-foreground">
                      {[phone.lastSeen.address, phone.lastSeen.country && countryName(phone.lastSeen.country)]
                        .filter((part) => part !== undefined && part !== "")
                        .join(", ")}
                    </span>
                  )}
                </span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{moment(DateTime.toEpochMillis(phone.pairedAt))}</TableCell>
            <TableCell className="pr-5 text-right">
              <RemovePhone phone={phone} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * The phones paired with the deployment, each with what it is and when and where it last called,
 * and adding one by a QR code its Camera reads.
 */
export function PhonesPage() {
  const phones = useAtomValue(phonesAtom)
  const askAgain = useAtomRefresh(phonesAtom)
  const [pairing, startPairing] = useAtom(startPairingAtom)
  // The phones there were when the code was shown, so the one that pairs with it stands out; once it
  // has, it is kept, since its code is used up even if the phone is then removed.
  const [adding, setAdding] = useState<{ readonly before: ReadonlySet<PhoneId>; readonly paired?: Phone } | undefined>(
    undefined,
  )
  // For how long ago each phone last called, which changes by the minute.
  const now = useNow(30_000)

  const listed = AsyncResult.isSuccess(phones) ? phones.value.phones : undefined
  const newcomer = adding === undefined ? undefined : listed?.find((phone) => !adding.before.has(phone.id))
  if (adding !== undefined && adding.paired === undefined && newcomer !== undefined) {
    setAdding({ ...adding, paired: newcomer })
  }
  const paired = adding?.paired ?? newcomer
  const waiting = adding !== undefined && paired === undefined && AsyncResult.isSuccess(pairing)

  useEffect(() => {
    if (!waiting) {
      return
    }
    const timer = window.setInterval(askAgain, askEvery)
    return () => window.clearInterval(timer)
  }, [waiting, askAgain])

  const add = () => {
    setAdding({ before: new Set(listed?.map((phone) => phone.id)) })
    startPairing()
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Phones</h1>
          <p className="text-sm text-muted-foreground">Phones that show your projects, each with its own key</p>
        </div>
        {adding === undefined && (
          <Button className="ml-auto" onClick={add} disabled={!AsyncResult.isSuccess(phones)}>
            Add a phone
          </Button>
        )}
      </header>

      {adding !== undefined && (
        <AddPhone pairing={pairing} paired={paired} onNewCode={add} onClose={() => setAdding(undefined)} />
      )}

      <Panel
        icon={SmartphoneIcon}
        title="Paired phones"
        subtitle="The latest paired first, with when and where each last called"
      >
        <Loaded result={phones}>
          {({ phones: list }) =>
            list.length === 0 ? (
              <div className="flex flex-col items-start gap-3 px-5 py-6">
                <p className="text-[15px]">No phones yet.</p>
                <p className="text-sm text-muted-foreground">Add your iPhone to see your projects on it.</p>
              </div>
            ) : (
              <PhoneTable phones={list} now={now} />
            )
          }
        </Loaded>
      </Panel>
    </div>
  )
}
