import type { TestChat, TestChatMessage, TestChatSummary } from './builderApi'

// Screenshot-only editorial examples supplied for the TJ prospect conversation.
// The timestamps below are SIMULATED display times, not historical message metadata.
// Never write these rows to Supabase or count them as actual tests/bookings.
type Origin = 'supplied' | 'illustrative'
type ShowcaseMessage = TestChatMessage & { origin: Origin }
export type ShowcaseChat = TestChat & {
  conversation: TestChatSummary & { showcase: true }
  messages: ShowcaseMessage[]
}

const makeChat = (key: string, title: string, start: string,
  lines: Array<[role: 'agent' | 'user', text: string, minutes: number, origin: Origin]>): ShowcaseChat => {
  const id = `tj-showcase-${key}`
  const startMs = new Date(start).getTime()
  const messages: ShowcaseMessage[] = lines.map(([role, text, minutes, origin], index) => ({
    id: `${id}-${index}`, role, text, isOpener: index === 0, feedback: null, origin,
    createdAt: new Date(startMs + minutes * 60_000).toISOString(),
  }))
  return {
    conversation: {
      id, title, source: 'playground', versionId: '', versionNumber: 0, isDraft: false,
      startedBy: null, createdAt: start, updatedAt: messages.at(-1)!.createdAt,
      messageCount: messages.length, thumbsUp: 0, thumbsDown: 0,
      lastReply: [...messages].reverse().find((line) => line.role === 'agent')?.text ?? '', showcase: true,
    },
    messages,
  }
}

export const TJ_SHOWCASE: ShowcaseChat[] = [
  makeChat('harri', 'Harri · Confirmed in chat · CGP-3••', '2026-06-01T10:12:00+03:00', [
      ['agent', 'Hei Harri! Autosi (CGP-3••) katsastus erääntyy pian. Haluatko, että varaan sinulle ajan?', 0, 'supplied'],
      ['user', 'Muistaakseni 15.6 mennessä pitää katsastaa. Auto nyt myynnissä mutta varaa aika kesäkuulle. Perun ajan jos auto myyty. Haluan varauksen Leppävedelle', 7, 'supplied'],
      ['agent', 'Selvä homma! Katsotaan sulle sopiva aika Leppävedelle. 😊', 8, 'illustrative'],
      ['user', '10.6 13.00 käy', 12, 'supplied'],
      ['agent', 'Mahtavaa! 👍 Aikasi on varattu:\n\n📅 10.6.2026\n🕒 13.00\n📍 TJ Katsastus Laukaa\n\nNähdään katsastuksessa!', 14, 'supplied'],
    ]),
  makeChat('jani', 'Jani · New vehicle · CNS-1••', '2026-10-09T09:05:00+03:00', [
      ['agent', 'Moro Jani Pyry tästä TJ-Katsastukselta. Kattelin et jos sulla edelleen on CNS-1•• alla, niin sen katsastus olis kohta taas tulossa. Ajattelin et hoidetaas ajoissa kuntoon ku ei viitti paperitta ajella, mikä päivä sulle sopis parhaiten?', 0, 'supplied'],
      ['user', 'ei oo enää, myin sen pari kuukautta sitte', 9, 'supplied'],
      ['agent', 'Aivan, kiitos kun kerroit! Onko sulla jo uus auto alla? Voin auttaa senkin katsastuksen kanssa.', 10, 'illustrative'],
      ['user', 'joo ostin volvon tossa vähä aikaa sitte', 15, 'illustrative'],
      ['agent', 'No niin! Mikä sen Volvon rekkari on? Voin tarkistaa katsastusajan, jos tiedot löytyy.', 16, 'illustrative'],
      ['user', 'ABC-123', 19, 'illustrative'],
      ['agent', 'Kiitos! Tarkistan tiedot ensin. Jos eräpäivä löytyy, haluatko että muistutan sua pari viikkoa ennen?', 21, 'illustrative'],
      ['user', 'joo laita vaa 👍', 25, 'illustrative'],
      ['agent', 'Selvä — muistutuksen voi asettaa, kun auton katsastustiedot on vahvistettu. Palaan silloin asiaan.', 26, 'illustrative'],
    ]),
  makeChat('sara', 'Sara · Work-shift scheduling · LMC-9••', '2026-10-02T11:38:00+03:00', [
      ['agent', 'Moro Sara Pyry tästä TJ-Katsastukselta. Kattelin et jos sulla edelleen on LMC-9•• alla, niin sen katsastus olis kohta taas tulossa. Ajattelin et hoidetaas ajoissa kuntoon ku ei viitti paperitta ajella, mikä päivä sulle sopis parhaiten?', 0, 'supplied'],
      ['user', 'Moi! No viikolla 41 sopis parhaiten kun oon aamuvuorossa niin olis sen jälkeen kätevä ajella siihen teille. 5.10 , 6.10 tai 7.10 niin oisko jolkkein noista päivistä semmosta aikaa kuin 14:45 ?', 18, 'supplied'],
      ['agent', 'Joo, iltapäivä aamuvuoron jälkeen käy järkeen. Tarkistan ensin nuo päivät ja klo 14.45 — en vielä varaa mitään.', 19, 'illustrative'],
      ['agent', 'Jos tiistaina 6.10. olisi vapaa 14.45, sopisiko se sulle?', 22, 'illustrative'],
      ['user', 'joo toi ois hyvä', 25, 'illustrative'],
      ['agent', 'Hyvä! Tarkistaisin ajan vielä varausjärjestelmästä ja vahvistaisin varauksen vasta sitten. Mikä nimi laitetaan varaukseen?', 26, 'illustrative'],
    ]),
  makeChat('inkeri', 'Inkeri · Finding a day · ECY-7••', '2026-10-09T10:06:00+03:00', [
      ['agent', 'Moro Inkeri Pyry tästä TJ-Katsastukselta. Kattelin et jos sulla edelleen on ECY-7•• alla, niin sen katsastus olis kohta taas tulossa. Ajattelin et hoidetaas ajoissa kuntoon ku ei viitti paperitta ajella, mikä päivä sulle sopis parhaiten?', 0, 'supplied'],
      ['user', 'Moi! Joo on, kiitos muistutuksesta. Mulle sopii kyllä jo esim tänään päivemmällä tai sitten ensiviikolla torstaina tai perjantaina?', 10, 'supplied'],
      ['agent', 'Moikka! Onhan tässä vaihtoehtoja 😊. Haluatko tulla jo tänään vai katsotaanko ens viikon loppupuolta?', 11, 'illustrative'],
      ['user', 'perjantai ois varmaa paras, mieluiten iltapäivällä', 15, 'illustrative'],
      ['agent', 'Selvä, perjantai-iltapäivä. Tarkistan vapaat ajat ensin — mikä asema sulle sopii?', 16, 'illustrative'],
      ['user', 'Leppävesi käy hyvin', 19, 'illustrative'],
      ['agent', 'Kiitos! Tarkistaisin Leppäveden perjantain ajat ja tarjoaisin pari oikeasti vapaata vaihtoehtoa ennen varausta.', 21, 'illustrative'],
    ]),
]

const SHOWCASE_VIEWERS = ['arslan@tryrapidscreen.com']

export function canSeeShowcase(email: string | null | undefined) {
  return SHOWCASE_VIEWERS.includes((email ?? '').trim().toLowerCase())
}

export function showcaseById(id: string): ShowcaseChat | null {
  return TJ_SHOWCASE.find((chat) => chat.conversation.id === id) ?? null
}

export function matchingShowcase(query: string): ShowcaseChat[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return TJ_SHOWCASE
  return TJ_SHOWCASE.filter(({ conversation, messages }) =>
    [conversation.title, ...messages.map((message) => message.text)].some((text) => text.toLocaleLowerCase().includes(needle)))
}
