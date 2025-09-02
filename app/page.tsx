"use client"

import type React from "react"

import useSWR from "swr"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { useToast } from "@/hooks/use-toast"
import { ModelSelector } from "@/components/model-selector"
import { ResponseCard } from "@/components/response-card"
import { Label } from "@/components/ui/label"
import { ThemeToggler } from "@/components/theme-toggler"

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

  const handleReset = () => {
    setPrompt("")
    setByModel({})
    setTotalMs(null)
  }

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

            if (evt.type === "model-start") {
              setByModel((s) => ({
                ...s,
                [evt.modelId]: { ...(s[evt.modelId] ?? { content: "" }), isComplete: false },
              }))
            } else if (evt.type === "ttfb") {
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
              setByModel((s) => {
                const prev = s[evt.modelId] ?? { content: "" }
                return {
                  ...s,
                  [evt.modelId]: {
                    ...prev,
                    tokens: {
                      prompt: evt.promptTokens,
                      completion: evt.completionTokens,
                      total: evt.totalTokens,
                    },
                  },
                }
              })
            } else if (evt.type === "model-done") {
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
              setTotalMs(evt.totalMs)
              clearTimeout(streamTimeout)
              break
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
    <div className="flex flex-col h-screen">
      <header className="p-4 border-b flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">LLM Wars</h1>
        <img src="/Gravix Layer-Photoroom.png" alt="Gravix Layer Logo" className="w-32 h-auto" />
        <div className="flex items-center gap-2">
          <a href={githubUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.109-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </Button>
          </a>
          <ThemeToggler />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {sortedModelIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="mb-8">
              <h1 className="text-4xl font-bold tracking-tight">
                Welcome to LLM Wars
              </h1>
            </div>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              Your arena for battling Large Language Models, powered by the Gravix Layer API. Select your contenders, give them a prompt, and witness their responses in a head-to-head comparison.
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-left">
              <div className="p-4 border rounded-lg bg-card max-w-xs">
                <h3 className="font-semibold mb-2">1. Select Models</h3>
                <p className="text-sm text-muted-foreground">Use the dropdown at the bottom to choose from a variety of cutting-edge language models.</p>
              </div>
              <div className="p-4 border rounded-lg bg-card max-w-xs">
                <h3 className="font-semibold mb-2">2. Craft Your Prompt</h3>
                <p className="text-sm text-muted-foreground">Enter any question, instruction, or creative idea into the prompt box.</p>
              </div>
              <div className="p-4 border rounded-lg bg-card max-w-xs">
                <h3 className="font-semibold mb-2">3. Compare Responses</h3>
                <p className="text-sm text-muted-foreground">Analyze the generated outputs side-by-side to see which model performs best for your task.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className={`grid gap-4 ${gridColsClass}`}>
            {sortedModelIds.map((modelId) => (
              <ResponseCard
                key={modelId}
                modelId={modelId}
                name={models.find((m) => m.id === modelId)?.name ?? modelId}
                state={byModel[modelId]}
                totalMs={totalMs}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="p-4">
        <div className="max-w-4xl mx-auto p-3 bg-card border rounded-2xl shadow-lg">
          <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="prompt">Enter your prompt</Label>
              <Textarea
                id="prompt"
                name="prompt"
                placeholder="Tell me a story about a robot who learns to love..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={disabled}
                className="h-16 resize-none"
              />
              <div className="flex gap-2 items-center">
                <Button type="submit" disabled={disabled}>
                  {hasActiveStreams ? `Generating...` : "Generate"}
                </Button>
                <Button type="button" variant="outline" onClick={handleReset} disabled={disabled}>
                  Reset
                </Button>
                <div className="flex items-center gap-2 w-96 ml-4">
                  <Label className="text-xs">Temp</Label>
                  <Slider
                    value={[tempNumber]}
                    onValueChange={([v]) => setTemperature(String(v))}
                    min={0}
                    max={2}
                    step={0.01}
                    disabled={disabled}
                  />
                  <Badge variant="outline" className="h-6">{tempNumber.toFixed(2)}</Badge>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Models</Label>
                <ModelSelector
                  models={models}
                  selected={selected}
                  onChange={setSelected}
                  loading={modelsLoading}
                  error={modelsError}
                />
              </div>
            </div>
          </form>
          <div className="flex justify-center mt-4">
            <p className="text-xs text-muted-foreground">
              Powered by{" "}
              <a
                href="https://gravix.layer.com"
                className="underline font-bold"
                target="_blank"
                rel="noopener noreferrer"
              >
                Gravix Layer
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
