export type DialCountry = 'fi' | 'se' | 'gb'

const RULES: Record<DialCountry, { dial: string; min: number; max: number }> = {
  fi: { dial: '358', min: 7, max: 12 },
  se: { dial: '46', min: 7, max: 10 },
  gb: { dial: '44', min: 10, max: 10 },
}

export const DIAL_COUNTRIES: DialCountry[] = ['fi', 'se', 'gb']

export const dialCode = (country: DialCountry) => RULES[country].dial

export const nationalLimit = (country: DialCountry) => RULES[country].max

export const nationalExample = (country: DialCountry) => (
  country === 'se' ? '70 123 45 67' : country === 'gb' ? '7123 456789' : '40 123 4567'
)

const digitsOf = (value: string) => value.replace(/\D/g, '')

// Sample leads are +358 40 000 …. A real Finnish mobile never uses that block.
export function isSamplePhone(digits: string) {
  return /^35840000\d+$/.test(digits)
}

function grouped(country: DialCountry, national: string) {
  if (country === 'fi' && national.length === 9) return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`
  if (country === 'se' && national.length === 9) return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7)}`
  if (country === 'gb' && national.length === 10) return `${national.slice(0, 4)} ${national.slice(4)}`
  return national
}

// Reads a number that already carries Finland, Sweden, or the UK. A local number without a country code returns null.
export function splitPhone(raw: string): { country: DialCountry; national: string; placeholder: boolean } | null {
  let digits = digitsOf(raw.trim())
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  for (const country of DIAL_COUNTRIES) {
    const dial = RULES[country].dial
    if (!digits.startsWith(dial)) continue
    const national = digits.slice(dial.length).replace(/^0/, '')
    const rule = RULES[country]
    if (national.length < rule.min || national.length > rule.max) continue
    return { country, national, placeholder: isSamplePhone(dial + national) }
  }
  return null
}

export type ComposedPhone = {
  ok: boolean
  e164: string
  display: string
  digits: string
  placeholder: boolean
}

const emptyPhone: ComposedPhone = { ok: false, e164: '', display: '', digits: '', placeholder: false }

// The country control owns the dial code. A pasted international number is accepted only when it matches that country.
export function composePhone(country: DialCountry, raw: string): ComposedPhone {
  const trimmed = raw.trim()
  if (!trimmed) return emptyPhone
  let national = ''
  const international = trimmed.startsWith('+') || digitsOf(trimmed).startsWith('00')
  if (international) {
    const split = splitPhone(trimmed)
    if (!split || split.country !== country) return emptyPhone
    national = split.national
  } else {
    national = digitsOf(trimmed).replace(/^0/, '')
  }
  const rule = RULES[country]
  if (national.length < rule.min || national.length > rule.max) return emptyPhone
  const digits = rule.dial + national
  const local = grouped(country, national)
  return { ok: true, e164: `+${digits}`, display: `+${rule.dial} ${local}`, digits, placeholder: isSamplePhone(digits) }
}

// Fills the field from a lead. Sample numbers stay empty so a real WhatsApp number can be typed.
export function prefillPhone(raw: string | null | undefined, language?: 'en' | 'fi' | 'sv' | null): { country: DialCountry; national: string } | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const split = splitPhone(text)
  if (split) return split.placeholder ? null : { country: split.country, national: grouped(split.country, split.national) }
  const national = digitsOf(text).replace(/^0/, '')
  if (!national) return null
  const country: DialCountry = language === 'sv' && national.startsWith('7') ? 'se' : language === 'en' && national.startsWith('7') ? 'gb' : 'fi'
  const rule = RULES[country]
  if (national.length < rule.min || national.length > rule.max) return null
  if (isSamplePhone(rule.dial + national)) return null
  return { country, national: grouped(country, national) }
}

// The number field stores digits only. A pasted + or 00 number selects Finland, Sweden, or the UK when it matches one.
export function applyPhoneInput(country: DialCountry, raw: string): { country: DialCountry; national: string } {
  const original = raw.trim()
  let digits = original.replace(/\D/g, '')
  const international = original.includes('+') || digits.startsWith('00')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (international) {
    for (const candidate of DIAL_COUNTRIES) {
      const rule = RULES[candidate]
      if (!digits.startsWith(rule.dial)) continue
      const national = digits.slice(rule.dial.length).replace(/^0/, '').slice(0, rule.max)
      return { country: candidate, national }
    }
  }
  return { country, national: digits.replace(/^0/, '').slice(0, RULES[country].max) }
}
