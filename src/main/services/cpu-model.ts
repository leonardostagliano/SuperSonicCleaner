/**
 * Human CPU name. systeminformation drops the generation ordinal
 * ("Gen Intel® Core™ i7-1355U") while the OS keeps it ("13th Gen Intel(R)
 * Core(TM) i7-1355U"), so the OS model wins when present. Otherwise the vendor
 * is prefixed only when the brand does not already name it.
 */
export function cpuModelName(manufacturer: string, brand: string, osModel?: string): string {
  const fromOs = osModel
    ?.replace(/\(R\)/gi, '®')
    .replace(/\(TM\)/gi, '™')
    .replace(/\s+/g, ' ')
    .trim()
  if (fromOs) return fromOs
  const vendor = manufacturer.trim()
  const name = brand.trim()
  if (!vendor) return name
  if (!name) return vendor
  const firstWord = vendor.split(/\s+/)[0].toLowerCase()
  return name.toLowerCase().includes(firstWord) ? name : `${vendor} ${name}`
}
