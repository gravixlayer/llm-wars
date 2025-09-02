"use client"

import { useMemo } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type Model = { id: string; name?: string }

export function ModelSelector({
  models,
  selected,
  onChange,
  disabled,
}: {
  models: Model[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const allSelected = selected.length > 0 && selected.length === models.length

  const handleToggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...new Set([...selected, id])])
    } else {
      onChange(selected.filter((m) => m !== id))
    }
  }

  const selectAll = () => onChange(models.map((m) => m.id))
  const clearAll = () => onChange([])

  const sorted = useMemo(
    () =>
      [...models].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: "base" })),
    [models],
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Models</CardTitle>
            <Badge variant="outline" className="font-mono">
              {selected.length}/{models.length}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={clearAll} disabled={disabled}>
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={selectAll} disabled={disabled || allSelected}>
              Select all
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 max-h-[340px] overflow-auto pr-1">
        {sorted.map((m) => {
          const checked = selected.includes(m.id)
          return (
            <label key={m.id} className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => handleToggle(m.id, Boolean(v))}
                disabled={disabled}
                aria-label={`Select model ${m.name ?? m.id}`}
              />
              <span className="truncate" title={m.name ?? m.id}>
                {m.name ?? m.id}
              </span>
            </label>
          )
        })}
        {sorted.length === 0 && <p className="text-sm text-muted-foreground">No models available.</p>}
      </CardContent>
    </Card>
  )
}
