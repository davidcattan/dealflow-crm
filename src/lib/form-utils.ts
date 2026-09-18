export function toArray(value: FormDataEntryValue | null): string[] {
  const str = String(value ?? '').trim()
  if (!str) return []
  return str
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}
