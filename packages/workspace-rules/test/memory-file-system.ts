import { Effect, FileSystem, PlatformError } from "effect"

/**
 * A read-only file system holding `files`, keyed by absolute path. Folders exist when a file is in
 * them. Enough for code that reads with `exists`, `readFileString`, and `readDirectory` (not recursive).
 */
export const memoryFileSystem = (files: Readonly<Record<string, string>>) => {
  const paths = Object.keys(files)
  const below = (folder: string) =>
    paths.filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1))

  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(Object.hasOwn(files, path) || below(path).length > 0),
    readFileString: (path) => {
      const text = files[path]
      return text === undefined
        ? Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: path,
            }),
          )
        : Effect.succeed(text)
    },
    readDirectory: (path) =>
      Effect.succeed([...new Set(below(path).map((file) => file.split("/")[0] ?? file))].toSorted()),
  })
}
