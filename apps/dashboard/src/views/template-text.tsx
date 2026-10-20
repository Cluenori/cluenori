/**
 * Text with placeholders, such as a route (`/api/notes/{id}`) or a log message's template
 * (`Export {ExportId} failed`), its placeholders dimmed so the words around them read first.
 */
export function TemplateText({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/(\{[^}]+\})/).map((part, index) =>
        part.startsWith("{") && part.endsWith("}") ? (
          <span key={index} className="text-muted-foreground">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}
