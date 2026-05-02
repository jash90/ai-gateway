/**
 * Format a number as currency (Polish locale).
 */
export function formatCredits(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n)
}

/**
 * Format a number as USD.
 */
export function formatUsd(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  }).format(n)
}

/**
 * Format an ISO date string to a human-readable Polish format.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Format an ISO date string as relative time in Polish.
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'przed chwilą'
  if (diffMin < 60) return `${diffMin} min temu`
  if (diffHr < 24) return `${diffHr} godz. temu`
  if (diffDay < 7) return `${diffDay} dni temu`
  return formatDate(d)
}

/**
 * Format a percentage value.
 */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
