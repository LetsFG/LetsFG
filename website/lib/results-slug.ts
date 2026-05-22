export function slugifyResultsQuery(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)

  const slugParts: string[] = []
  let length = 0

  for (const word of words) {
    const nextLength = length + word.length + (slugParts.length > 0 ? 1 : 0)
    if (slugParts.length >= 10 || nextLength > 64) break
    slugParts.push(word)
    length = nextLength
  }

  return slugParts.join('-')
}
