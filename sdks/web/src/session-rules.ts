// The session rules, the Swift SDK's (sdks/swift/Sources/Cluenori/Sessions.swift) in TypeScript,
// apart from where their effects go, so each rule is tested with the times given: a session starts
// when the app comes to the foreground, and ends 30 s after it leaves it, or when its process ends.

/** How long the app may be out of sight before its session ends, in milliseconds. */
export const sessionTimeoutMs = 30_000

/** The session open now, as it is kept between page loads or runs. */
export interface OpenSession {
  readonly id: string
  /** The release and environment it ran in: its signals are theirs, even after an update. */
  readonly release: string
  readonly environment: string
  readonly startedAt: number
  /** Since when the app is in the foreground; absent while it isn't. */
  readonly foregroundSince?: number
  /** Since when the app is in the background; absent while it isn't. */
  readonly backgroundSince?: number
  /** The foreground time of the intervals already over. */
  readonly foregroundMs: number
  /** The last moment the app was known to run. */
  readonly lastSeenAt: number
}

/** What happened that matters to the session. */
export type SessionEvent =
  | { readonly _tag: "foreground"; readonly at: number }
  | { readonly _tag: "background"; readonly at: number }
  /** Time passed: a session 30 s in the background ends. */
  | { readonly _tag: "tick"; readonly at: number }
  /** A new page load or run started: the kept session ends, unless it was left less than 30 s ago. */
  | { readonly _tag: "launch"; readonly at: number }
  /** The session ends now, as on sign-out or at the end of a program's run. */
  | { readonly _tag: "end"; readonly at: number }

export interface EndedSession {
  readonly session: OpenSession
  readonly at: number
  readonly foregroundMs: number
}

export interface SessionChange {
  readonly ended?: EndedSession
  readonly started?: OpenSession
  readonly session: OpenSession | undefined
}

const elapsed = (from: number, to: number) => Math.max(0, to - from)

const end = (session: OpenSession, at: number): EndedSession => ({
  session,
  at,
  foregroundMs:
    session.foregroundMs + (session.foregroundSince === undefined ? 0 : elapsed(session.foregroundSince, at)),
})

const begin = (id: string, at: number, release: string, environment: string): OpenSession => ({
  id,
  release,
  environment,
  startedAt: at,
  foregroundSince: at,
  foregroundMs: 0,
  lastSeenAt: at,
})

/**
 * Applies `event` to `session`: the session after it, and the session it ended and the one it
 * started, if any. `newId` makes the ID of a session that starts.
 */
export const applySessionEvent = (
  event: SessionEvent,
  session: OpenSession | undefined,
  origin: { readonly release: string; readonly environment: string },
  newId: () => string,
): SessionChange => {
  switch (event._tag) {
    case "foreground": {
      if (session !== undefined && session.backgroundSince === undefined) {
        return { session: { ...session, lastSeenAt: Math.max(session.lastSeenAt, event.at) } }
      }
      if (session?.backgroundSince !== undefined && event.at - session.backgroundSince < sessionTimeoutMs) {
        // Back in time: the session goes on.
        const { backgroundSince: _left, ...rest } = session
        return { session: { ...rest, foregroundSince: event.at, lastSeenAt: event.at } }
      }
      const started = begin(newId(), event.at, origin.release, origin.environment)
      const ended =
        session?.backgroundSince === undefined ? undefined : end(session, session.backgroundSince + sessionTimeoutMs)
      return ended === undefined ? { started, session: started } : { ended, started, session: started }
    }
    case "background": {
      if (session?.foregroundSince === undefined) {
        return { session }
      }
      const { foregroundSince, ...rest } = session
      return {
        session: {
          ...rest,
          foregroundMs: session.foregroundMs + elapsed(foregroundSince, event.at),
          backgroundSince: event.at,
          lastSeenAt: Math.max(session.lastSeenAt, event.at),
        },
      }
    }
    case "tick": {
      if (session === undefined) {
        return { session }
      }
      if (session.backgroundSince === undefined) {
        return { session: { ...session, lastSeenAt: Math.max(session.lastSeenAt, event.at) } }
      }
      if (event.at - session.backgroundSince >= sessionTimeoutMs) {
        return { ended: end(session, session.backgroundSince + sessionTimeoutMs), session: undefined }
      }
      return { session }
    }
    case "launch": {
      if (session === undefined) {
        return { session }
      }
      // A page reloaded within 30 s of leaving goes on with its session, as the app came back in time.
      if (session.backgroundSince !== undefined && event.at - session.backgroundSince < sessionTimeoutMs) {
        return { session }
      }
      const at =
        session.backgroundSince === undefined
          ? session.lastSeenAt
          : Math.min(session.backgroundSince + sessionTimeoutMs, Math.max(event.at, session.backgroundSince))
      return { ended: end(session, at), session: undefined }
    }
    case "end":
      return session === undefined ? { session } : { ended: end(session, event.at), session: undefined }
  }
}
