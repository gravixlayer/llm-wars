"use client"

import type React from "react"

import useSWR from "swr"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { ModelSelector } from "@/components/model-selector"
import { ResponseCard } from "@/components/response-card"
import { Label } from "@/components/ui/label"

type Model = { id: string; name?: string }

type StreamState = {
  content: string
  ttfbMs?: number
  latencyMs?: number
  tokens?: { prompt?: number | null; completion?: number | null; total?: number | null }
  error?: string
  isComplete?: boolean
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function Page() {
  const { toast } = useToast()

  const githubUrl = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || "https://github.com/gravixlayer"

  const {
    data: modelsData,
    isLoading: modelsLoading,
    error: modelsError,
  } = useSWR<{ models: Model[] }>("/api/models", fetcher, { revalidateOnFocus: false })

  const models = modelsData?.models ?? []
  const [selected, setSelected] = useState<string[]>([])
  const [prompt, setPrompt] = useState("")
  const [temperature, setTemperature] = useState("0.7")
  const [submitting, setSubmitting] = useState(false)
  const [totalMs, setTotalMs] = useState<number | null>(null)

  // streaming state per model
  const [byModel, setByModel] = useState<Record<string, StreamState>>({})
  const doneCountRef = useRef(0)
  const expectedModelsRef = useRef(0)

  const tempNumber = useMemo(() => {
    const n = Number(temperature)
    if (Number.isNaN(n)) return 0.7
    return Math.min(2, Math.max(0, n))
  }, [temperature])

  const disabled = submitting || modelsLoading

  const sortedModelIds = useMemo(() => {
    const ids = Object.keys(byModel)
    return ids.sort((a, b) => {
      const la = byModel[a]?.latencyMs ?? Number.MAX_SAFE_INTEGER
      const lb = byModel[b]?.latencyMs ?? Number.MAX_SAFE_INTEGER
      return la - lb
    })
  }, [byModel])

  const gridColsClass = useMemo(() => {
    const count = Object.keys(byModel).length
    return count <= 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
  }, [byModel])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setByModel({})
    setTotalMs(null)
    doneCountRef.current = 0
    expectedModelsRef.current = selected.length

    if (!prompt.trim()) {
      toast({ title: "Enter a prompt", description: "Please provide a prompt before generating." })
      return
    }
    if (selected.length === 0) {
      toast({ title: "Select models", description: "Choose at least one model to compare." })
      return
    }

    // seed with placeholders so cards render immediately
    const seed: Record<string, StreamState> = {}
    for (const m of selected) {
      seed[m] = { content: "", isComplete: false }
    }
    setByModel(seed)

    setSubmitting(true)
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          models: selected,
          temperature: tempNumber,
        }),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "")
        throw new Error(errText || `HTTP ${res.status}`)
      }

      reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      // Set up a timeout to handle hung streams
      const streamTimeout = setTimeout(() => {
        console.warn("Stream timeout - forcing completion")
        setSubmitting(false)
        if (reader) {
          reader.cancel().catch(console.error)
        }

        // Mark any incomplete models as errored
        setByModel((current) => {
          const updated = { ...current }
          for (const modelId of selected) {
            if (!updated[modelId]?.isComplete) {
              updated[modelId] = {
                ...updated[modelId],
                error: "Stream timeout",
                isComplete: true,
              }
            }
          }
          return updated
        })
      }, 120000) // 2 minute timeout

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue

          try {
            const evt = JSON.parse(line)
            console.log("Received event:", evt) // Debug log

            if (evt.type === "start") {
              console.log("Stream started for models:", evt.models)
            } else if (evt.type === "model-start") {
              console.log(`Model ${evt.modelId} started`)
              setByModel((s) => ({
                ...s,
                [evt.modelId]: { ...(s[evt.modelId] ?? { content: "" }), isComplete: false },
              }))
            } else if (evt.type === "ttfb") {
              console.log(`TTFB for ${evt.modelId}: ${evt.ttfbMs}ms`)
              setByModel((s) => ({
                ...s,
                [evt.modelId]: { ...(s[evt.modelId] ?? { content: "" }), ttfbMs: evt.ttfbMs },
              }))
            } else if (evt.type === "delta") {
              setByModel((s) => {
                const prev = s[evt.modelId] ?? { content: "" }
                return {
                  ...s,
                  [evt.modelId]: {
                    ...prev,
                    content: (prev.content || "") + (evt.text || ""),
                  },
                }
              })
            } else if (evt.type === "usage") {
              console.log(`Usage for ${evt.modelId}:`, {
                prompt: evt.promptTokens,
                completion: evt.completionTokens,
                total: evt.totalTokens,
              })
              setByModel((s) => {
                const prev = s[evt.modelId] ?? { content: "" }
                return {
                  ...s,
                  [evt.modelId]: {
                    ...prev,
                    tokens: {
                      prompt: evt.promptTokens ?? prev.tokens?.prompt ?? null,
                      completion: evt.completionTokens ?? prev.tokens?.completion ?? null,
                      total: evt.totalTokens ?? prev.tokens?.total ?? null,
                    },
                  },
                }
              })
            } else if (evt.type === "model-done") {
              console.log(`Model ${evt.modelId} completed in ${evt.latencyMs}ms`)
              setByModel((s) => {
                const prev = s[evt.modelId] ?? { content: "" }
                return {
                  ...s,
                  [evt.modelId]: {
                    ...prev,
                    latencyMs: evt.latencyMs,
                    isComplete: true,
                  },
                }
              })
              doneCountRef.current += 1
            } else if (evt.type === "error") {
              console.error(`Error for ${evt.modelId}:`, evt.error)
              setByModel((s) => {
                const prev = s[evt.modelId] ?? { content: "" }
                return {
                  ...s,
                  [evt.modelId]: {
                    ...prev,
                    error: evt.error,
                    latencyMs: evt.latencyMs,
                    isComplete: true,
                  },
                }
              })
              doneCountRef.current += 1
            } else if (evt.type === "end") {
              console.log(`All models completed. Total time: ${evt.totalMs}ms`)
              setTotalMs(evt.totalMs)
              clearTimeout(streamTimeout)
              break
            } else if (evt.type === "ping") {
              // Keep-alive ping, ignore
            }
          } catch (parseErr) {
            console.warn("Failed to parse event line:", line.substring(0, 100))
          }
        }
      }

      clearTimeout(streamTimeout)
    } catch (err: any) {
      console.error("Streaming error:", err)
      toast({
        title: "Streaming error",
        description: err?.message ?? String(err),
        variant: "destructive",
      })

      // Mark all incomplete models as errored
      setByModel((current) => {
        const updated = { ...current }
        for (const modelId of selected) {
          if (!updated[modelId]?.isComplete) {
            updated[modelId] = {
              ...updated[modelId],
              error: err?.message ?? String(err),
              isComplete: true,
            }
          }
        }
        return updated
      })
    } finally {
      setSubmitting(false)
      if (reader) {
        reader.cancel().catch(console.error)
      }
    }
  }

  const completedModels = Object.values(byModel).filter((state) => state.isComplete).length
  const hasActiveStreams = submitting && completedModels < expectedModelsRef.current

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-balance text-3xl font-semibold tracking-tight">LLM Wars</h1>
          <Button variant="outline" asChild>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-2 max-w-prose">
          Enter a prompt, select models from Gravix Layer, and compare responses side-by-side with live streaming,
          latency and token usage.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-[1.2fr_.8fr]">
        <Card className="order-2 md:order-1">
          <CardHeader className="pb-1">
            <CardTitle className="text-base">Your Prompt</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <form className="grid gap-4" onSubmit={onSubmit}>
              <div className="grid gap-2">
                <Textarea
                  id="prompt"
                  aria-label="Prompt"
                  placeholder="Ask anything..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={14}
                  disabled={disabled}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="temperature">Temperature</Label>
                <div className="flex items-center gap-3">
                  <Slider
                    id="temperature"
                    min={0}
                    max={2}
                    step={0.1}
                    value={[tempNumber]}
                    onValueChange={(vals) => setTemperature(String(vals[0] ?? 0.7))}
                    disabled={disabled}
                    className="w-full"
                    aria-label="Temperature"
                  />
                  <Badge variant="secondary" className="min-w-12 justify-center">
                    {tempNumber.toFixed(1)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Higher values increase creativity, lower values increase determinism.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={disabled}>
                  {submitting ? `Generating… (${completedModels}/${expectedModelsRef.current})` : "Generate"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPrompt("")
                    setByModel({})
                    setTotalMs(null)
                    doneCountRef.current = 0
                    expectedModelsRef.current = 0
                  }}
                  disabled={submitting}
                >
                  Reset
                </Button>
                {typeof totalMs === "number" && (
                  <Badge variant="outline" className="font-mono">
                    {totalMs} ms
                  </Badge>
                )}
                {hasActiveStreams && (
                  <Badge variant="secondary" className="font-mono">
                    {completedModels}/{expectedModelsRef.current} complete
                  </Badge>
                )}
              </div>
            </form>
          </CardContent>
          <CardFooter className="pt-2">
            <p className="text-xs text-muted-foreground">
              Your prompt is streamed concurrently to all selected models.
            </p>
          </CardFooter>
        </Card>

        <div className="order-1 md:order-2">
          <ModelSelector models={models} selected={selected} onChange={setSelected} disabled={disabled} />
          {modelsError && (
            <p className="mt-3 text-sm text-destructive">
              Failed to load models. Ensure the API key is set and the endpoint is reachable.
            </p>
          )}
          {modelsLoading && <p className="mt-3 text-sm text-muted-foreground">Loading models…</p>}
        </div>
      </section>

      <Separator className="my-8" />

      <section className={`grid gap-4 items-stretch ${gridColsClass}`}>
        {Object.keys(byModel).length > 0 ? (
          sortedModelIds.map((modelId) => {
            const s = byModel[modelId]
            return (
              <ResponseCard
                key={modelId}
                modelId={modelId}
                latencyMs={s?.latencyMs}
                ttfbMs={s?.ttfbMs}
                tokens={s?.tokens}
                content={s?.content}
                error={s?.error}
              />
            )
          })
        ) : (
          <p className="text-sm text-muted-foreground">Responses will appear here.</p>
        )}
      </section>

      <footer className="mt-10 flex items-center justify-center">
        <p className="text-xs text-muted-foreground">
          Powered by{" "}
          <a
            className="underline underline-offset-4 hover:text-foreground"
            href="https://platform.gravixlayer.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gravix Layer
          </a>
        </p>
      </footer>
    </main>
  )
}
