"use client"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MarkdownViewer } from "@/components/markdown-viewer"

export function ResponseCard({
  modelId,
  name,
  state,
  totalMs,
}: {
  modelId: string
  name: string
  state: {
    content: string
    ttfbMs?: number
    latencyMs?: number
    tokens?: { prompt?: number | null; completion?: number | null; total?: number | null }
    error?: string
    isComplete?: boolean
  }
  totalMs: number | null
}) {
  const { content, ttfbMs, latencyMs, tokens, error } = state
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-pretty">{name}</CardTitle>
          <div className="flex items-center gap-2">
            {typeof ttfbMs === "number" && <Badge variant="outline">TTFB {ttfbMs} ms</Badge>}
            {typeof latencyMs === "number" && <Badge variant="secondary">{latencyMs} ms</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto max-h-96">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        ) : content ? (
          <div className="text-sm leading-relaxed">
            <MarkdownViewer content={content} />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Waiting for tokens…</div>
        )}
      </CardContent>
      <CardFooter className="mt-auto pt-2 border-t">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">Tokens:</span>
          <Badge variant="outline">prompt {tokens?.prompt ?? "n/a"}</Badge>
          <Badge variant="outline">completion {tokens?.completion ?? "n/a"}</Badge>
          <Badge variant="outline">total {tokens?.total ?? "n/a"}</Badge>
        </div>
      </CardFooter>
    </Card>
  )
}
