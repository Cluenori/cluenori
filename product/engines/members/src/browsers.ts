// What people call a browser, by what its User-Agent says: the first rule that matches wins, so a
// browser that names others in its User-Agent (Edge says Chrome and Safari) comes before them.
const browsers: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
]

const systems: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b/, "macOS"],
  [/\bWindows\b/, "Windows"],
  [/\bLinux\b/, "Linux"],
]

/**
 * What people call the browser a User-Agent is, `Safari on macOS`, or just one of the two; undefined
 * when it says neither. An iPad's Safari says it is a Mac's, as it asks for desktop pages.
 */
export const browserOf = (userAgent: string | undefined) => {
  if (userAgent === undefined) {
    return undefined
  }
  const browser = browsers.find(([pattern]) => pattern.test(userAgent))?.[1]
  const system = systems.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (browser !== undefined && system !== undefined) {
    return `${browser} on ${system}`
  }
  return browser ?? system
}
