export const isValidGameId = (gameId: string): boolean => {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!isoDateRegex.test(gameId)) {
    return false
  }

  const date = new Date(gameId)
  const startDate = new Date('2025-01-01')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)

  return date >= startDate && date < tomorrow && date.toISOString().split('T')[0] === gameId
}
