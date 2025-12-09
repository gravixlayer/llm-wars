import { NextResponse } from "next/server"
import { z } from "zod"

const BodySchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  models: z.array(z.string().min(1)).min(1, "Select at least one model"),
  temperature: z.union([z.number(), z.string()]).optional(),
})

function getApiKey() {
  const key = process.env.GRAVIXLAYER_API_KEY
  if (!key) {
    console.log("[v0] Missing GRAVIXLAYER_API_KEY")
    throw new Error("Missing GRAVIXLAYER_API_KEY. Set it in Project Settings > Environment Variables.")
  }
  return key
}

// Increase default timeout to avoid prematurely aborting long streams
async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 180000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

const INFERENCE_URL = "https://api.gravixlayer.com/v1/inference"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const apiKey = getApiKey()

    let json: any
    try {
      json = await req.json()
    } catch {
      console.log("[v0] Failed to parse JSON body")
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    let body: z.infer<typeof BodySchema>
    try {
      body = BodySchema.parse(json)
    } catch (e: any) {
      console.log("[v0] Body validation failed:", e?.message)
      return NextResponse.json({ error: "Invalid request body", details: e?.message }, { status: 400 })
    }

    // Guard: don't allow embedding models to be sent here
    const badModels = body.models.filter((m) => m.toLowerCase().includes("embed"))
    if (badModels.length) {
      console.log("[v0] Embedding models filtered out on generate:", badModels)
      return NextResponse.json(
        { error: "Embedding models cannot be used for chat generation", models: badModels },
        { status: 400 },
      )
    }

    const temperatureRaw = body.temperature
    let temperature = 0.7
    if (typeof temperatureRaw === "number") {
      temperature = temperatureRaw
    } else if (typeof temperatureRaw === "string") {
      const n = Number.parseFloat(temperatureRaw)
      if (!Number.isNaN(n)) temperature = n
    }
    if (temperature < 0) temperature = 0
    if (temperature > 2) temperature = 2

    const systemMessage = "You are a helpful and friendly assistant."
    const startedAll = Date.now()

    console.log("[v0] /api/generate start", {
      models: body.models,
      temperature,
      hasKey: !!process.env.GRAVIXLAYER_API_KEY,
    })

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder()
        const write = (obj: any) => {
          try {
            controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"))
          } catch (e) {
            console.error("[v0] Failed to write to stream:", e)
          }
        }

        let ended = false
        const safeEnd = () => {
          if (!ended) {
            write({ type: "end", totalMs: Date.now() - startedAll, ts: Date.now() })
            try {
              controller.close()
            } catch (e) {
              console.error("[v0] Failed to close controller:", e)
            }
            ended = true
          }
        }

        write({ type: "start", models: body.models, temperature, ts: Date.now() })

        let doneCount = 0
        const totalModels = body.models.length

        const streamOneModel = async (modelId: string) => {
          const modelStart = Date.now()
          let sawFirstToken = false
          let gotAnyToken = false
          let modelCompleted = false

          const markModelDone = (error?: string) => {
            if (modelCompleted) return
            modelCompleted = true
            const latencyMs = Math.round(Date.now() - modelStart)
            if (error) {
              write({ type: "error", modelId, error, latencyMs, ts: Date.now() })
            } else {
              write({ type: "model-done", modelId, latencyMs, ts: Date.now() })
            }
            doneCount++
            if (doneCount >= totalModels) {
              safeEnd()
            }
          }

          try {
            write({ type: "model-start", modelId, ts: Date.now() })

            const res = await fetchWithTimeout(`${INFERENCE_URL}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                "Cache-Control": "no-cache",
              },
              body: JSON.stringify({
                model: modelId,
                messages: [
                  { role: "system", content: systemMessage },
                  { role: "user", content: body.prompt },
                ],
                temperature,
                stream: true,
                stream_options: { include_usage: true },
              }),
            })

            if (!res.ok || !res.body) {
              const text = await res.text().catch(() => "")
              console.error("[v0] Upstream error:", modelId, res.status, text || res.statusText)
              throw new Error(`HTTP ${res.status}: ${text || res.statusText || "Request failed"}`)
            }

            console.log("[v0] Upstream connected for", modelId, "status", res.status)

            const decoder = new TextDecoder()
            let buffer = ""
            const reader = res.body.getReader()

            // Keepalive pings to defeat proxies buffering
            let lastWrite = Date.now()
            const ping = setInterval(() => {
              if (Date.now() - lastWrite > 14000) {
                write({ type: "ping", ts: Date.now() })
                lastWrite = Date.now()
              }
            }, 15000)

            // Robust SSE parsing: accumulate multi-line "data:" blocks and flush on blank line
            const flushEventData = (dataStr: string) => {
              if (!dataStr) return
              if (dataStr === "[DONE]") {
                clearInterval(ping)
                markModelDone()
                return
              }
              try {
                const chunk = JSON.parse(dataStr)

                const delta =
                  chunk?.choices?.[0]?.delta?.content ??
                  chunk?.choices?.[0]?.delta?.reasoning_content ??
                  chunk?.choices?.[0]?.text ??
                  chunk?.choices?.[0]?.message?.content ??
                  ""

                if (delta) {
                  if (!sawFirstToken) {
                    sawFirstToken = true
                    write({ type: "ttfb", modelId, ttfbMs: Date.now() - modelStart, ts: Date.now() })
                  }
                  gotAnyToken = true
                  write({ type: "delta", modelId, text: delta, ts: Date.now() })
                  lastWrite = Date.now()
                }

                const usage = chunk?.usage
                if (usage) {
                  write({
                    type: "usage",
                    modelId,
                    promptTokens: usage?.prompt_tokens ?? usage?.promptTokens ?? usage?.input_tokens ?? null,
                    completionTokens:
                      usage?.completion_tokens ?? usage?.completionTokens ?? usage?.output_tokens ?? null,
                    totalTokens: usage?.total_tokens ?? usage?.totalTokens ?? usage?.total ?? null,
                    ts: Date.now(),
                  })
                  lastWrite = Date.now()
                }
              } catch {
                // ignore malformed JSON lines
              }
            }

            try {
              let eventBufferParts: string[] = []
              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split(/\r?\n/)
                buffer = lines.pop() || ""

                for (const rawLine of lines) {
                  const line = rawLine.trim()

                  // Blank line -> end of one SSE event; flush accumulated data
                  if (!line) {
                    if (eventBufferParts.length) {
                      const dataStr = eventBufferParts.join("\n").trim()
                      eventBufferParts = []
                      flushEventData(dataStr)
                    }
                    continue
                  }

                  // Accumulate only data lines; ignore id:/event:/retry: lines
                  if (line.startsWith("data:")) {
                    const part = line.slice(5).trim()
                    eventBufferParts.push(part)
                  }
                }
              }

              // flush any trailing event payload (no newline at end)
              if (eventBufferParts.length) {
                const dataStr = eventBufferParts.join("\n").trim()
                eventBufferParts = []
                flushEventData(dataStr)
              }

              // also check a trailing single-line buffer if it contains 'data:'
              if (buffer.trim().startsWith("data:")) {
                const dataStr = buffer.trim().slice(5).trim()
                flushEventData(dataStr)
              }
            } finally {
              clearInterval(ping)
            }

            // fallback to non-streaming if we didn't get any token chunks
            if (!gotAnyToken) {
              console.log("[v0] No streaming tokens; using non-streaming fallback for", modelId)
              try {
                const nonStreamRes = await fetchWithTimeout(`${INFERENCE_URL}/chat/completions`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model: modelId,
                    messages: [
                      { role: "system", content: systemMessage },
                      { role: "user", content: body.prompt },
                    ],
                    temperature,
                    stream: false,
                  }),
                })

                if (!nonStreamRes.ok) {
                  const t = await nonStreamRes.text().catch(() => "")
                  console.error(
                    "[v0] Non-stream fallback failed:",
                    modelId,
                    nonStreamRes.status,
                    t || nonStreamRes.statusText,
                  )
                  throw new Error(`HTTP ${nonStreamRes.status}: ${t || nonStreamRes.statusText}`)
                }

                const json = await nonStreamRes.json().catch(() => null)
                if (!json) throw new Error("Failed to parse non-streaming response")

                const text = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? ""

                if (text) {
                  if (!sawFirstToken) {
                    sawFirstToken = true
                    write({ type: "ttfb", modelId, ttfbMs: Date.now() - modelStart, ts: Date.now() })
                  }
                  write({ type: "delta", modelId, text, ts: Date.now() })
                  gotAnyToken = true
                }

                const usage = json?.usage
                if (usage) {
                  write({
                    type: "usage",
                    modelId,
                    promptTokens: usage?.prompt_tokens ?? usage?.promptTokens ?? usage?.input_tokens ?? null,
                    completionTokens:
                      usage?.completion_tokens ?? usage?.completionTokens ?? usage?.output_tokens ?? null,
                    totalTokens: usage?.total_tokens ?? usage?.totalTokens ?? usage?.total ?? null,
                    ts: Date.now(),
                  })
                }
              } catch (fallbackErr: any) {
                markModelDone(fallbackErr?.message ?? String(fallbackErr))
                return
              }
            }

            markModelDone()
          } catch (err: any) {
            console.error("[v0] Model stream error:", modelId, err?.message || err)
            markModelDone(err?.message ?? String(err))
          }
        }

        await Promise.allSettled(body.models.map((m) => streamOneModel(m)))

        // guard: auto-end in case anything hangs
        setTimeout(() => {
          safeEnd()
        }, 120000)

        safeEnd()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate, proxy-revalidate",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    })
  } catch (err: any) {
    console.error("[v0] POST handler error:", err)
    return NextResponse.json(
      { error: "Failed to generate responses", details: err?.message ?? String(err) },
      { status: 500 },
    )
  }
}
