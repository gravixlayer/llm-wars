import React from "react"

function renderMarkdownContent(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      const code = part.slice(1, -1)
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
          {code}
        </code>
      )
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      const boldText = part.slice(2, -2)
      return <strong key={i}>{boldText}</strong>
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

export function MarkdownViewer({ content }: { content: string }) {
  // Split by fenced code blocks ```lang\n...\n```
  const segments: Array<{ type: "code" | "text"; lang?: string; value: string }> = []
  const fenceRegex = /```(\w+)?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: "code", lang: match[1], value: match[2] })
    lastIndex = fenceRegex.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) })
  }

  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert">
      {segments.map((seg, idx) => {
        if (seg.type === "code") {
          return (
            <pre key={idx} className="rounded-md bg-muted p-4 overflow-x-auto">
              <code className="font-mono text-sm" data-lang={seg.lang || "text"}>
                {seg.value}
              </code>
            </pre>
          )
        }
        const paras = seg.value
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
        return paras.length > 0 ? (
          <div key={idx} className="space-y-3">
            {paras.map((p, i) => {
              if (/^={3,}\s*$/.test(p) || /^-{3,}\s*$/.test(p) || /^\*{3,}\s*$/.test(p)) {
                return <hr key={i} className="my-4 border-border" />
              }
              return (
                <p key={i} className="leading-relaxed">
                  {renderMarkdownContent(p)}
                </p>
              )
            })}
          </div>
        ) : null
      })}
    </div>
  )
}
