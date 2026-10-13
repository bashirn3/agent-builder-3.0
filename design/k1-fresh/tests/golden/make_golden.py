#!/usr/bin/env python3
"""Writes tests/golden/k1-golden.json: reference conversations that sound the way K1 wants, one per scenario id.

  python3 tests/golden/make_golden.py

Every new version is judged pairwise against these (v2_judge.py golden) and must not lose to any of them. Each chat says
where it came from: "run" is a real agent reply kept as it was, "edited" is a real conversation whose replies were
rewritten to the current rules, "written" was written for a rule no earlier run covered. Dates and times are examples;
the judge compares how the agent talks, not which day it found. To change a golden chat, edit it here and rerun.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'k1-golden.json'
PAL, ITA, KOU = 'K1 Katsastus Jyväskylä Palokka', 'K1 Katsastus Turku Itäharju', 'K1 Katsastus Kouvola Kankaanpää'


def slots(day='Thursday', date='2026-10-15', times=('09:00', '13:00', '16:45'), station=PAL, price=76, measuring=True, date_to=None):
    return {'tool': 'get_slots', 'input': {'date_from': date, 'date_to': date_to or date, 'include_measuring': 'true' if measuring else 'false'}, 'output': json.dumps({'ok': True, 'station': station, 'days': [{'date': date, 'weekday': day, 'free_count': 14, 'suggestions': [{'time': t, 'slot_id': f'K1-{date.replace("-", "")}-{t.replace(":", "")}'} for t in times]}], 'price': {'total_eur': price}, 'product_ids': [2246] if not measuring else [2246, 2250]}, ensure_ascii=False)}


def info(station=PAL, opens='09:00', closes='17:00', bookable=True, link=None, times=(), asked=''):
    data = {'ok': True, 'station': {'name': station}, 'hours': {'status': 'open', 'opens': opens, 'closes': closes}, 'assistant_can_book': bookable,
            'price': {'total_eur': 76, 'breakdown': [{'name': 'Inspection', 'eur': 46}, {'name': 'Statutory measurements', 'eur': 30}]}}
    if link:
        data['official_booking_link'] = link
    if times:
        data['availability'] = [{'suggestions': [{'time': t} for t in times]}]
    return {'tool': 'get_station_info', 'input': {'station': asked}, 'output': json.dumps(data, ensure_ascii=False)}


def booked(number='KX7P2QLM', station=PAL, total=76):
    return {'tool': 'book_inspection_invite', 'input': {}, 'output': json.dumps({'success': True, 'booking_number': number, 'event_id': 'ev1', 'station_name': station, 'total_eur': total})}


def tool(name, output):
    return {'tool': name, 'input': {}, 'output': json.dumps(output, ensure_ascii=False)}


def chat(cid, lang, source, turns, station=PAL, plate='TST-700', product='004', note=''):
    return {'id': cid, 'suite': 'golden', 'lang': lang, 'source': source, 'note': note,
            'lead': {'lang': lang, 'station': station, 'product': product, 'plate': plate},
            'turns': [{'user': u, 'reply': r, 'status': 200, 'fallback': False, 'steps': s} for u, r, s in turns], 'flags': []}


GOLDEN = [
    # greetings and small talk
    chat('voice.greet.fi.0', 'fi', 'written', [('moi', 'Moi! Etsinkö sulle katsastusajan?', [])]),
    chat('voice.greet.sv.0', 'sv', 'written', [('hej', 'Hej! Ska jag hitta en besiktningstid åt dig?', [])]),
    chat('voice.greet.en.0', 'en', 'edited', [('hey', 'Hey! Want me to find you an inspection time?', [])]),
    chat('joke.fi', 'fi', 'written', [('Hahaa, sait mut viestittelemään kesken pelin 😂', 'Pelaa rauhassa loppuun 😄 Etsinkö sitten katsastusajan?', [])]),
    chat('joke.en', 'en', 'run', [('Haha you caught me mid-game 😂', 'No worries, I won’t pause the match 😄 Want me to find a time for the inspection?', [])]),
    chat('howareyou.fi', 'fi', 'written', [('Mitä kuuluu?', 'Hyvää kiitos! Etsinkö sulle katsastusajan?', [])]),
    chat('devil.x.turns.compliment', 'fi', 'edited', [
        ('Olet kiva!', 'Kiitos! 😊 Etsinkö sulle katsastusajan?', []),
        ('Mitä aikoja on huomenna?', 'To 15.10. klo 9.15, 13.00 tai 16.45. Mikä sopii?', [slots(times=('09:15', '13:00', '16:45'))]),
    ]),
    # consent and the booking flow
    chat('pilot.consent.fi.joo', 'fi', 'run', [('joo', 'To 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [slots()])]),
    chat('pilot.consent.sv.visst', 'sv', 'run', [('visst', 'Tors 15.10. kl. 9.00, 13.00 eller 16.45. Vilken passar?', [slots()])]),
    chat('pilot.consent.en.sure', 'en', 'run', [('sure', 'Thu 15 Oct: 09:00, 13:00 or 16:45. Which one?', [slots()])]),
    chat('pilot.fast_book.fi.pal', 'fi', 'written', [
        ('joo', 'To 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [slots()]),
        ('Klo 09:00 sopii', 'To 15.10. klo 9.00, TST-710. Millä nimellä varaan?', []),
        ('Matti Meikäläinen', 'Varattu! To 15.10. klo 9.00, K1 Katsastus Jyväskylä Palokka, varausnumero KX7P2QLM. Yhteensä 76 €, maksetaan asemalla.', [booked()]),
    ], plate='TST-710'),
    chat('pilot.fast_book.sv.pal', 'sv', 'run', [
        ('visst', 'Tors 15.10. kl. 9.00, 13.00 eller 16.45. Vilken passar?', [slots()]),
        ('Kl 09:00 passar bra', 'Tors 15.10. kl. 9.00 för TST-711. Vilket namn ska jag skriva?', []),
        ('Anna Andersson', 'Bokat! Tors 15.10. kl. 9.00 på K1 Katsastus Jyväskylä Palokka, bokningsnummer KX7P2QLM. Totalt 76 €, betalas på stationen.', [booked()]),
    ], plate='TST-711'),
    chat('pilot.fast_book.en.ita', 'en', 'run', [
        ('yes', 'Thu 15 Oct: 09:00, 13:00 or 16:45. Which one?', [slots(station=ITA)]),
        ('The 09:00 one works for me', 'Thu 15 Oct at 09:00 for TST-702. What name should I put on it?', []),
        ('John Smith', 'Booked for Thu 15 Oct at 09:00 at K1 Katsastus Turku Itäharju. Booking number KX7P2QLM, total €76, payable at the station.', [booked(station=ITA)]),
    ], station=ITA, plate='TST-702'),
    chat('times_next_week.en', 'en', 'written', [('Next week works, what times do you have?', 'Mon 19 Oct: 09:00, 12:30 or 16:15. Which one?', [slots('Monday', '2026-10-19', ('09:00', '12:30', '16:15'), date_to='2026-10-25')])]),
    chat('pilot.v7.friday.reject_first.fi', 'fi', 'written', [
        ('Haluan ajan perjantaille, mahdollisimman myöhään.', 'Pe 16.10. myöhäisin vapaa on klo 16.45. Sopiiko?', [slots('Friday', '2026-10-16', ('09:00', '13:00', '16:45'))]),
        ('Ei tuo käy, muttei 16.10.', 'Pe 23.10. klo 16.30 on myöhäisin vapaa. Käykö se?', [slots('Friday', '2026-10-23', ('09:15', '13:00', '16:30'), date_to='2026-10-30')]),
    ]),
    chat('pilot.measurements.new_without.en', 'en', 'written', [
        ('I want to book tomorrow, but without the measurements. I get those done at a garage.', 'Thu 15 Oct, inspection only: 09:00, 13:00 or 16:45. Which one?', [slots(price=46, measuring=False)]),
        ('The 09:00 one works for me', 'Thu 15 Oct at 09:00 for TST-735, inspection only. What name should I put on it?', []),
        ('John Smith', 'Booked for Thu 15 Oct at 09:00 at K1 Katsastus Jyväskylä Palokka, inspection only. Booking number KX7P2QLM, total €46, payable at the station.', [booked(total=46)]),
    ], plate='TST-735'),
    # acknowledgements, fillers and goodbyes
    chat('pilot.done_acks.sv', 'sv', 'edited', [
        ('visst', 'Tors 15.10. kl. 9.00, 13.00 eller 16.45. Vilken passar?', [slots()]),
        ('Kl 09:00 passar bra', 'Tors 15.10. kl. 9.00 för TST-722. Vilket namn ska jag skriva?', []),
        ('Anna Andersson', 'Bokat! Tors 15.10. kl. 9.00 på K1 Katsastus Jyväskylä Palokka, bokningsnummer KX7P2QLM. Totalt 76 €, betalas på stationen.', [booked()]),
        ('Tack', 'Ha det bra!', []),
        ('Ok', '👍', []),
        ('Ok', '👍', []),
    ], plate='TST-722'),
    chat('pilot.handoff_acks.fi', 'fi', 'written', [
        ('Haluan puhua oikean ihmisen kanssa.', 'Täältä en saa sua yhdistettyä, mutta K1:n ajanvarauksessa vastaa ihminen: 0306 100 100.', [tool('escalate_to_human', {'success': True})]),
        ('Joo', 'Hyvää päivänjatkoa!', []),
        ('Joo', '👍', []),
        ('Joo', '👍', []),
    ]),
    chat('pilot.replay.chat4a_filler_not_consent.fi', 'fi', 'written', [
        ('Miks sun nimi on tuplana', 'En tiedä, miksi se näkyy noin. Pahoittelut sekaannuksesta!', []),
        ('Ei mitää', 'Haluatko, että etsin katsastusajan?', []),
    ], station=KOU, plate='ABC-123'),
    chat('thanks.en', 'en', 'run', [('thanks bye', 'Take care!', [])]),
    # language switches
    chat('switch.sv_to_fi', 'sv', 'written', [
        ('Hej', 'Hej! Ska jag hitta en besiktningstid åt dig?', []),
        ('Voidaanko jatkaa suomeksi? Mihin asti olette auki tänään?', 'Palokka on tänään auki klo 17.00 asti.', [info()]),
    ]),
    chat('switch.fi_to_en', 'fi', 'written', [
        ('Moi', 'Moi! Etsinkö sulle katsastusajan?', []),
        ('Actually, can we continue in English? What times tomorrow?', 'Thu 15 Oct: 09:00, 13:00 or 16:45. Which one?', [slots()]),
    ]),
    chat('switch.mid_flow', 'fi', 'written', [
        ('Onko huomenna aikoja?', 'To 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [slots()]),
        ('What about the day after tomorrow?', 'Fri 16 Oct: 09:30, 12:15 or 16:00. Which one?', [slots('Friday', '2026-10-16', ('09:30', '12:15', '16:00'))]),
        ('Och på fredag då?', 'Fre 16.10. kl. 9.30, 12.15 eller 16.00. Vilken passar?', [slots('Friday', '2026-10-16', ('09:30', '12:15', '16:00'))]),
    ]),
    chat('switch.en_to_sv', 'en', 'run', [('Vad kostar besiktningen?', 'På Palokka kostar besiktningen 46 € och de lagstadgade mätningarna 30 €, totalt 76 €. Betalning sker på stationen.', [info()])]),
    chat('other_lang_de', 'fi', 'written', [('Hallo, ich möchte einen Termin buchen', 'Hei! Palvelen suomeksi, ruotsiksi tai englanniksi. Etsinkö sulle ajan?', [])]),
    # number origin, opt-out
    chat('pilot.where_number.fi', 'fi', 'written', [('Mistä sait numeroni?', 'Autosi on katsastettu asemallamme ja jätit silloin meille numerosi, siksi muistutus tulee siihen.', [])]),
    chat('pilot.v7.brief.origin.sv1', 'sv', 'written', [('Var har du fått mitt telefonnummer?', 'Din bil har besiktigats på en av våra stationer och du lämnade då ditt nummer till oss, därför kommer påminnelsen dit.', [])]),
    chat('optout.fi', 'fi', 'edited', [('Lopeta viestit', 'Lopetin muistutukset, et saa niitä enää.', [tool('opt_out', {'success': True, 'opted_out': True})])]),
    chat('devil.x.opt.stop_sv', 'sv', 'written', [('Sluta skicka meddelanden', 'Jag har stoppat påminnelserna, du får inga fler.', [tool('opt_out', {'success': True, 'opted_out': True})])]),
    chat('pilot.v8.optout_inspected.fi', 'fi', 'written', [
        ('autoni on jo katsstettu', 'Hienoa, kiitos tiedosta! Lopetin muistutukset tälle autolle.', [tool('opt_out', {'success': True, 'opted_out': True})]),
        ('en halua näitä viestejä enää', 'Muistutukset on jo lopetettu, et saa niitä enää.', []),
    ], plate='ABC-888'),
    chat('plate_sold.fi', 'fi', 'written', [
        ('Myin auton, uusi rekisterinumero on DEF-456', 'Onko DEF-456 bensa-, diesel- tai hybridiauto vai täyssähkö?', []),
        ('Se on diesel', 'To 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [slots()]),
        ('Mitä aikoja huomenna on?', 'Huomenna to 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [slots()]),
    ], plate='TST-061'),
    # frustration, hand-offs, limits
    chat('devil.swearing', 'fi', 'written', [('Tää botti on ihan paska, vittu', 'Pahoittelut, että tämä on turhauttanut. Etsinkö sulle ajan, vai haluatko soittaa ajanvaraukseen 0306 100 100?', [])]),
    chat('angry.en', 'en', 'written', [('Last time everything went wrong, I am really angry', 'I’m sorry your last visit went badly. You can talk it through with K1 on 0306 100 100, or I can find you a new time here.', [tool('escalate_to_human', {'success': True})])]),
    chat('human.sv', 'sv', 'written', [('Jag vill prata med en människa', 'Här kan jag inte koppla dig vidare, men på K1:s bokning svarar en människa: 0306 100 100.', [tool('escalate_to_human', {'success': True})])]),
    chat('devil.pizza', 'en', 'edited', [('Order me a large pizza with pineapple.', 'Pizza is beyond me, but I can find you an inspection time. Shall I?', [])]),
    chat('under18.fi', 'fi', 'written', [('Olen 15-vuotias', 'Katsastuksen varaa täysi-ikäinen, jolla on ajokortti. Hän voi kirjoittaa tänne, kun on valmis.', [])]),
    # stations and scope
    chat('pilot.capital.fi', 'fi', 'written', [('Asun Helsingissä, voiko teillä varata ajan sinne?', 'Tässä chatissa en voi varata Helsinkiin. Helsingin asemille varaat linkistä tai numerosta 0306 100 100.', [info('K1 Katsastus Helsinki Konala', bookable=False, link='https://www.k1katsastus.fi/ajanvaraus')])]),
    chat('pilot.v7.kouvola.book.fi', 'fi', 'written', [('Haluan varata ajan huomiselle', 'Kouvolan ajat varataan linkistä tai numerosta 0306 100 100: https://www.k1katsastus.fi/ajanvaraus', [info(KOU, bookable=False, link='https://www.k1katsastus.fi/ajanvaraus')])], station=KOU),
    chat('pilot.v7.referent.listed_stations.en', 'en', 'written', [
        ('Which stations can you book a time at?', 'Here I can book at Palokka (Jyväskylä) and Itäharju (Turku). Other stations go through the booking link or 0306 100 100.', []),
        ('What time are they open until tomorrow?', 'Palokka until 17:00, Itäharju until 16:30.', [info(PAL, asked='Palokka'), info(ITA, closes='16:30', asked='Itäharju')]),
    ], station='K1 Katsastus Espoo Suomenoja'),
    # bookings
    chat('voice.mine.cancel_none.fi', 'fi', 'written', [('Haluan perua varaukseni', 'En näe täällä tehtyä varausta. K1:n sivuilla tehdyt varaukset eivät näy minulle. Varaanko sulle uuden ajan?', [tool('get_my_bookings', {'count': 0, 'bookings': []})])]),
    chat('pilot.v8.rename.fi', 'fi', 'written', [
        ('joo', 'To 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [slots()]),
        ('Klo 09:00 sopii', 'To 15.10. klo 9.00, TST-833. Millä nimellä varaan?', []),
        ('Matti Meikäläinen', 'Varattu! To 15.10. klo 9.00, K1 Katsastus Jyväskylä Palokka, varausnumero KX7P2QLM. Yhteensä 76 €, maksetaan asemalla.', [booked()]),
        ('Vaihda varauksen nimeksi Maria Pyy', 'Vaihdanko varauksen nimeksi Maria Pyy?', []),
        ('Kyllä', 'Vaihdettu! To 15.10. klo 9.00 nimellä Maria Pyy, uusi varausnumero R4TQ9WEX.', [tool('cancel_booking', {'success': True, 'recorded': True}), booked('R4TQ9WEX')]),
    ], plate='TST-833'),
]


def main():
    ids = [g['id'] for g in GOLDEN]
    assert len(ids) == len(set(ids)), 'duplicate golden id'
    OUT.write_text(json.dumps(GOLDEN, ensure_ascii=False, indent=1))
    print(f'wrote {OUT.name}: {len(GOLDEN)} golden chats')


if __name__ == '__main__':
    main()
