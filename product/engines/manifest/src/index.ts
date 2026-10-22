/**
 * The manifest: the one small, cached response an app's SDK reads at launch and on resume, which
 * tells it what to do before it shows anything. It holds the version policy now, and grows with flags,
 * messages, and What's New; it never shrinks, because shipped builds read it for years.
 */
export {
  AppManifest,
  AvailableUpdate,
  ManifestQuery,
  StoreVersion,
  UpdateDecision,
  UpdateText,
  VersionPolicy,
} from "./manifest.ts"
export { AppManifestGroup } from "./manifest-api.ts"
