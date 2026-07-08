"use client"

import { Select } from "@/components/ui/select"

interface CustomSelectOption {
  value: string
  label: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  placeholder?: string
  className?: string
}

export function CustomSelect({ value, onChange, options, placeholder, className }: CustomSelectProps) {
  return <Select value={value} onValueChange={onChange} options={options} placeholder={placeholder} className={className} />
}
