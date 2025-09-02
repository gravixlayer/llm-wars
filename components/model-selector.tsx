"use client"

import { MultiSelect } from "@/components/ui/multi-select"

type Model = { id: string; name?: string }

export function ModelSelector({
  models,
  selected,
  onChange,
  disabled,
  loading,
  error,
}: {
  models: Model[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  loading?: boolean
  error?: Error | null
}) {
  const options = models.map((m) => ({
    value: m.id,
    label: m.name ?? m.id,
  }))

  return (
    <MultiSelect
      options={options}
      onValueChange={onChange}
      defaultValue={selected}
      placeholder="Select models"
      disabled={disabled || loading}
      maxCount={3}
    />
  )
}
