/**
 * Number formatters used across analytics views. Polish locale.
 */

const NF_INT = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const NF_USD = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
})
const NF_USD_SHORT = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const NF_PCT = new Intl.NumberFormat('pl-PL', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})

export function formatInt(n: number | null | undefined): string {
  if (n == null) return '—'
  return NF_INT.format(n)
}

export function formatUsd(n: number | null | undefined, short = false): string {
  if (n == null) return '—'
  return short ? NF_USD_SHORT.format(n) : NF_USD.format(n)
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null) return '—'
  return NF_PCT.format(n)
}

/** "1.2k", "543", "5.6M" — for axis labels where space is tight. */
export function formatCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/** Latency in ms → "523 ms" / "1.2 s". */
export function formatMs(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`
  return `${Math.round(n)} ms`
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  return formatCompact(n)
}
