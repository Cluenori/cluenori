import { Effect } from "effect"
import { createHighlighterCore, type GrammarState, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

// Add the languages you need. Each one loads the first time it is used.
const languages = {
  bash: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
}

const aliases: Record<string, keyof typeof languages> = {
  js: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
}

// Every code block shares one shiki instance, created on first use. Its
// promise is kept, so blocks that load at the same time wait for the same one.
let highlighter: Promise<HighlighterCore> | undefined

const getHighlighter = Effect.promise(() => {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })

  return highlighter
})

function isListedLanguage(name: string): name is keyof typeof languages {
  return Object.hasOwn(languages, name)
}

function getLanguage(language: string) {
  const name = language.toLowerCase()

  if (name === "ansi") {
    return name
  }

  if (isListedLanguage(name)) {
    return name
  }

  // Own keys only: "constructor" or "toString" would otherwise find Object's.
  return Object.hasOwn(aliases, name) ? (aliases[name] ?? null) : null
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export const loadHighlighter = Effect.fn("loadHighlighter")(function* (language: string) {
  const lang = getLanguage(language)

  if (lang === null) {
    return null
  }

  const shiki = yield* getHighlighter
  const needsLanguage = lang !== "ansi" && !shiki.getLoadedLanguages().includes(lang)

  if (needsLanguage) {
    yield* Effect.promise(() => shiki.loadLanguage(languages[lang]))
  }

  return {
    // Returns one React node per line, and the grammar state after the last
    // line. Pass that state back to continue where the code left off.
    highlight(code: string, state?: GrammarState) {
      const tokenize = (text: string) =>
        shiki.codeToTokens(text, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          ...(state !== undefined ? { grammarState: state } : {}),
        }).tokens

      // ANSI has no grammar state, so each line is tokenized on its own and
      // gets the same colors whether it arrives in one piece or streams.
      const tokens = lang === "ansi" ? code.split("\n").flatMap((line) => tokenize(line)) : tokenize(code)

      return {
        lines: tokens.map((line) =>
          line.map((token, index) => (
            <span key={index} style={token.htmlStyle} className="text-(--shiki-light) dark:text-(--shiki-dark)">
              {token.content}
            </span>
          )),
        ),
        state: shiki.getLastGrammarState(tokens),
      }
    },
  }
})

// Returns one React node per line, or null for a language that is not listed.
export const highlightCode = Effect.fn("highlightCode")(function* (code: string, language: string) {
  const loaded = yield* loadHighlighter(language)

  return loaded !== null ? loaded.highlight(code).lines : null
})
