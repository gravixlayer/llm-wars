import { NextResponse } from "next/server"

const MODELS_URL = "https://api.gravixlayer.com/v1/models/list/internal/only"

function getApiKey() {
  const key = process.env.GRAVIXLAYER_API_KEY
  if (!key) {
    throw new Error("Missing GRAVIXLAYER_API_KEY. Set it in Project Settings > Environment Variables.")
  }
  return key
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

export async function GET() {
  try {
    const apiKey = getApiKey()
    const res = await fetchWithTimeout(MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: "Failed to fetch models from GraviXLayer", status: res.status, details: text },
        { status: 502 },
      )
    }

    const data = await res.json()

    // Normalize various possible payload shapes to { models: [{id, name, ...raw}] }
    let rawList: any[] = []
    if (Array.isArray(data)) {
      rawList = data
    } else if (Array.isArray((data as any)?.data)) {
      rawList = (data as any).data
    } else if (Array.isArray((data as any)?.models)) {
      rawList = (data as any).models
    }

    const normalized = rawList
      .map((m) => {
        const id = m?.id ?? m?.model_id ?? m?.name ?? String(m)
        const name = m?.name ?? m?.display_name ?? id
        if (!id) return null
        return { id: String(id), name: String(name), _raw: m }
      })
      .filter(Boolean) as { id: string; name: string; _raw: any }[]

    // Filter to exclude ONLY embeddings-only models using explicit output_modalities
    const models = normalized
      .filter(({ _raw }) => {
        const om = _raw?.output_modalities
        if (Array.isArray(om) && om.length > 0) {
          const lower = om.map((x: any) => String(x).toLowerCase())
          const onlyEmbeddings = lower.every((m) => m === "embedding" || m === "embeddings")
          if (onlyEmbeddings) return false
        }
        return true // keep models without explicit embeddings-only modalities
      })
      .map(({ id, name }) => ({ id, name }))

    return NextResponse.json({ models })
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected error fetching models", details: err?.message ?? String(err) },
      { status: 500 },
    )
  }
}
