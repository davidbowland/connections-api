import { fixedDateCategoryConstraints } from '../assets/constraints'

const getMonthWeekFromBeginning = (date: Date): number => {
  return Math.floor((date.getDate() - 1) / 7) + 1
}

const geMonthWeekFromEnd = (date: Date): number => {
  const currentDate = date.getDate()
  const monthEndDate = new Date(date.getFullYear(), date.getMonth() + 1, currentDate).getDate()
  return Math.floor((monthEndDate - currentDate) / 7) + 1
}

export const getDateConstraint = (date: Date): string | undefined => {
  const month = date.getMonth()
  const dayOfMonth = date.getDate()

  const dateStr = `0${month + 1}`.slice(-2) + `0${dayOfMonth}`.slice(-2)
  const fixedConstraint = fixedDateCategoryConstraints[dateStr]
  if (fixedConstraint) {
    return fixedConstraint
  }

  const dayOfWeek = date.getDay()
  const weekFromBeginning = getMonthWeekFromBeginning(date)
  const weekFromEnd = geMonthWeekFromEnd(date)

  // MLK Day (3rd Monday of January)
  if (month === 0 && dayOfWeek === 1 && weekFromBeginning === 3) {
    return 'all words must be related to Martin Luther King Jr./civil rights/equality, but categories are NOT required to be civil rights-related'
  }

  // Mother's Day (2nd Sunday of May)
  if (month === 4 && dayOfWeek === 0 && weekFromBeginning === 2) {
    return "all words must be related to Mother's Day/mothers/family, but categories are NOT required to be family-related"
  }

  // Memorial Day (last Monday of May)
  if (month === 4 && dayOfWeek === 1 && weekFromEnd === 1) {
    return 'all words must be related to Memorial Day/remembrance/military sacrifice, but categories are NOT required to be military-related'
  }

  // Father's Day (3rd Sunday of June)
  if (month === 5 && dayOfWeek === 0 && weekFromBeginning === 3) {
    return "all words must be related to Father's Day/fathers/family, but categories are NOT required to be family-related"
  }

  // Labor Day (1st Monday of September)
  if (month === 8 && dayOfWeek === 1 && weekFromBeginning === 1) {
    return 'all words must be related to Labor Day/work, but categories are NOT required to be work-related'
  }

  // Thanksgiving (4th Thursday of November)
  if (month === 10 && dayOfWeek === 4 && weekFromBeginning === 4) {
    return 'all words must be related to Thanksgiving/gratitude/autumn, but categories are NOT required to be Thanksgiving-related'
  }

  // Black Friday (Friday after 4th Thursday of November)
  if (month === 10 && dayOfWeek === 5) {
    const yesterday = new Date(date.getFullYear(), month, dayOfMonth - 1)
    if (getMonthWeekFromBeginning(yesterday) === 4) {
      return 'all words must be related to Black Friday/shopping/deals, but categories are NOT required to be shopping-related'
    }
  }

  // Cyber Monday (Monday after 4th Thursday of November)
  // The 5th of December is a week from the last possible Thanksgiving, November 28th
  if (dayOfWeek === 1 && (month === 10 || (month === 11 && dayOfMonth < 5))) {
    const lastThursday = new Date(date.getFullYear(), month, dayOfMonth - 4)
    if (getMonthWeekFromBeginning(lastThursday) === 4) {
      return 'all words must be related to Cyber Monday/the Internet/technology, but categories are NOT required to be technology-related'
    }
  }

  return undefined
}
