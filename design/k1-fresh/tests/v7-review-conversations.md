# K1 agent v7: review conversations

Generated from the final v7 candidate against the Muster staging calendar. One block per scenario; "OK" means every automatic check passed.


## pilot.v7.brief.origin.after_booking_offer.en (en) OK

- **Customer:** Yes please
- **Agent:** Wed 7 Oct: 09:00, 13:00 or 16:45. Which time suits you?  _[get_slots]_
- **Customer:** Where did you get my number?
- **Agent:** You had your car inspected at one of our stations and gave us your number then, so the reminder comes to it.  _[no tool]_

## pilot.v7.brief.origin.en1 (en) OK

- **Customer:** Where did you get my number?
- **Agent:** You had your car inspected at one of our stations and gave us your number then, so the reminder comes to it.  _[no tool]_

## pilot.v7.brief.origin.en2 (en) OK

- **Customer:** How do you have my phone number?
- **Agent:** You had your car inspected at one of our stations and gave us your number then, so the reminder comes to it.  _[no tool]_

## pilot.v7.brief.emission.en (en) OK

- **Customer:** When should the emission tests be done?
- **Agent:** Emission tests apply to cars registered after August 1976. They’re normally done during the periodic inspection, and a certificate from an earlier test is valid for three months.  _[faq_lookup]_

## pilot.v7.brief.emission.fi (fi) OK

- **Customer:** Milloin päästömittaukset pitää tehdä?
- **Agent:** Päästömittaus tehdään autoille, jotka on rekisteröity elokuun 1976 jälkeen. Tätä vanhempia autoja ei mitata.  _[no tool]_

## pilot.v7.brief.emission.old_car.en (en) OK

- **Customer:** My car is from 1971. Does it need an emission test?
- **Agent:** Cars registered before August 1976 are historic vehicles and don’t need the emission test. The inspection only, without measuring, is available Wed 7 Oct at 09:00, 13:00 or 16:45. Which time suits you?  _[faq_lookup, get_slots]_

## pilot.v7.brief.emission.old_car.fi (fi) OK

- **Customer:** Autoni on vuodelta 1972, tarvitseeko sille päästömittauksen?
- **Agent:** Vuonna 1972 käyttöönotetulle autolle ei tehdä päästömittausta, sillä mittaus koskee vasta 8/1976 jälkeen rekisteröityjä autoja. Voin etsiä sinulle ajan pelkkään katsastukseen.  _[no tool]_

## pilot.v7.brief.hours.latest.en (en) OK

- **Customer:** What is the latest time I can have my car inspected tomorrow?
- **Agent:** The latest inspection time at Palokka tomorrow, Wed 7 Oct, is 16:45. The station closes at 17:00.  _[get_slots]_
- **Customer:** And next Friday?
- **Agent:** Next Friday, 9 Oct, the latest inspection time at Palokka is 16:45. The station closes at 17:00.  _[get_slots]_

## pilot.v7.brief.hours.latest.fi (fi) OK

- **Customer:** Mihin asti katsastukseen pääsee viimeistään huomenna?
- **Agent:** Palokan viimeinen vapaa katsastusaika huomenna ke 7.10. on klo 16.45, asema sulkeutuu klo 17.00.  _[get_slots]_
- **Customer:** Entä ensi perjantaina?
- **Agent:** Pe 9.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?  _[get_slots, get_slots]_

## pilot.v7.brief.power.combustion.measuring.en (en) OK

- **Customer:** Why does my booking include a second item?
- **Agent:** It includes the statutory emissions measurement for petrol or diesel cars, added by default with the inspection. You can leave it out if you’ll have it done elsewhere.  _[no tool]_

## pilot.v7.brief.power.combustion.price.en (en) OK

- **Customer:** How much does the inspection cost?
- **Agent:** At Palokka, the inspection is €46 and the statutory measurements are €30, so the total is €76. Payment is at the station.  _[get_station_info]_

## pilot.v7.brief.power.electric.engine.en (en) CHECK: CHECK forbidden reply /petrol|diesel/

- **Customer:** What engine type does my car have according to your records?
- **Agent:** Our records show TST-794 is fully electric, so it has an electric motor rather than a petrol or diesel engine.  _[no tool]_

## pilot.v7.brief.power.electric.measuring.en (en) OK

- **Customer:** Do I need the emissions measuring for my car?
- **Agent:** No, your fully electric TST-791 doesn’t need emissions measuring. It isn’t part of the electric vehicle inspection.  _[no tool]_

## pilot.v7.brief.power.electric.measuring.fi (fi) OK

- **Customer:** Tarvitaanko autolleni päästömittaus?
- **Agent:** TST-792 on täyssähköauto, joten siihen ei kuulu päästömittausta.  _[faq_lookup]_

## pilot.v7.brief.power.electric.price.en (en) OK

- **Customer:** How much does the inspection cost?
- **Agent:** At Palokka, the electric car inspection is €46, payable at the station.  _[get_station_info]_

## pilot.v7.brief.power.multi.electric.en (en) OK

- **Customer:** Is my car fully electric according to your records?
- **Agent:** No, our records list TST-797 as a hybrid, not fully electric.  _[no tool]_

## pilot.v7.brief.power.multi.measuring.fi (fi) OK

- **Customer:** Pitääkö hybridiautolle tehdä päästömittaus?
- **Agent:** Hybridiauton päästömittaus sisältyy oletuksena katsastukseen, mutta voit teettää sen muualla ja varata pelkän katsastuksen. Palokassa ke 7.10. klo 9.00, 13.00 tai 16.45, mikä sopii?  _[get_slots]_

## pilot.v7.brief.power.multi.price.en (en) OK

- **Customer:** How much does the inspection cost?
- **Agent:** At Palokka, the inspection is €46 and the statutory measurements are €30, so the total is €76, payable at the station.  _[get_station_info]_

## pilot.v7.brief.faq.autotohtori.en (en) OK

- **Customer:** How much does an Autotohtori inspection cost together with a normal inspection?
- **Agent:** The Autotohtori service costs €79 when booked with a normal inspection. The normal inspection is charged separately.  _[faq_lookup]_

## pilot.v7.brief.faq.autotohtori.sv (sv) CHECK: CHECK unexpected tool escalate_to_human

- **Customer:** Vad kostar Autotohtori tillsammans med en vanlig besiktning?
- **Agent:** Autotohtori kostar 79 € när den bokas tillsammans med en besiktning; då bokas de som en gemensam, längre tid. Själva besiktningspriset varierar beroende på station och tid.  _[escalate_to_human, faq_lookup]_

## pilot.v7.brief.faq.decommission.en (en) OK

- **Customer:** What do I need to decommission my car from traffic?
- **Agent:** As the vehicle’s owner or holder, you can decommission it at an A-Katsastus or Ajovarma service point that handles registrations. Bring your ID and, if one exists for the vehicle, the notification part of the registration certificate; it isn’t mandatory.  _[faq_lookup]_

## pilot.v7.brief.faq.leasing.en (en) OK

- **Customer:** Can I get my leasing car inspected and have the invoice go to the leasing company?
- **Agent:** If you’re a contractual customer of certain leasing companies, the invoice can be sent directly to the leasing company. If you’re unsure whether it’s covered and the inspection is urgent, you can pay yourself and later check whether your contract allows reimbursement against a receipt.  _[faq_lookup]_

## pilot.v7.brief.faq.licence_renew.en (en) OK

- **Customer:** My driving licence is about to expire. What should I do?
- **Agent:** You can renew your driving licence at an Ajovarma service point. Bring your previous licence and 2 passport photos, unless you meet one of the photo exemptions; check the requirements and medical report details here: https://traficom.fi/en/transport/drivers-and-vehicles/driving-licenses/renew-your-driving-licence  _[faq_lookup]_

## pilot.v7.brief.faq.no_match.en (en) OK

- **Customer:** How do I register a boat?
- **Agent:** I can’t help with boat registration, but I can help with your vehicle inspection.  _[no tool]_

## pilot.v7.brief.faq.ownership.en (en) OK

- **Customer:** How soon do I have to register a change of ownership after buying a car?
- **Agent:** The change of ownership must be registered within 7 days of the owner or holder information changing.  _[faq_lookup]_

## pilot.v7.brief.faq.ownership.fi (fi) OK

- **Customer:** Kuinka pian omistajanvaihto pitää ilmoittaa?
- **Agent:** Omistajanvaihdos pitää ilmoittaa rekisteriin 7 päivän kuluessa omistajan tai haltijan tietojen muutoksesta. Jos määräpäivä osuu lauantaille tai pyhäpäivälle, ilmoituksen voi tehdä viimeistään seuraavana arkipäivänä.  _[faq_lookup]_

## pilot.v7.brief.faq.post_period.en (en) OK

- **Customer:** How long do I have for the post-inspection after failing?
- **Agent:** You have one month from the date the vehicle first failed its periodic inspection to complete the post-inspection.  _[faq_lookup]_

## pilot.v7.brief.faq.post_period.fi (fi) OK

- **Customer:** Kuinka kauan minulla on aikaa jälkitarkastukseen?
- **Agent:** Jälkitarkastus on tehtävä viimeistään kuukauden kuluessa siitä, kun auto hylättiin määräaikaiskatsastuksessa.  _[faq_lookup]_

## pilot.v7.brief.faq.price_not_faq.en (en) OK

- **Customer:** How much does an inspection cost?
- **Agent:** At Palokka, the inspection is €46 plus €30 for the statutory measurements, €76 total. Payment is at the station.  _[get_station_info]_

## pilot.v7.brief.faq.receipt.en (en) OK

- **Customer:** Where can I get a receipt for a prepaid appointment?
- **Agent:** You can get the actual sales receipt at the service point when the inspection takes place. The email appointment confirmation isn’t a valid receipt for tax authorities.  _[faq_lookup]_

## pilot.v7.brief.faq.then_book.en (en) OK

- **Customer:** How long do I have for the post-inspection after failing?
- **Agent:** You have one month from the date the vehicle first failed its periodic inspection to complete the post-inspection.  _[faq_lookup]_
- **Customer:** OK. Can I book a time tomorrow?
- **Agent:** Wed 7 Oct: 09:00, 13:00 or 16:45. Which time works for you?  _[get_slots]_

## pilot.v7.price.after_type.en (en) OK

- **Customer:** How much does an inspection cost?
- **Agent:** Is it a petrol, diesel or hybrid car, or fully electric?  _[get_station_info]_
- **Customer:** Petrol, a normal car
- **Agent:** At Palokka, the inspection is €46 and the statutory measurements are €30, so the total is €76, payable at the station.  _[get_station_info]_

## pilot.v7.price.after_type.fi (fi) OK

- **Customer:** Paljonko katsastus maksaa?
- **Agent:** Onko auto bensiini-, diesel- tai hybridiauto vai täyssähköauto?  _[get_station_info]_
- **Customer:** Bensiini
- **Agent:** Palokassa katsastus maksaa 76 €: katsastus 46 € ja lakisääteiset mittaukset 30 €. Maksu hoidetaan asemalla.  _[get_station_info]_

## pilot.v7.price.ask_first.en (en) OK

- **Customer:** How much does an inspection cost?
- **Agent:** Is it a petrol, diesel or hybrid car, or fully electric? I can then give you the exact inspection price at Palokka.  _[get_station_info]_

## pilot.v7.price.ask_first.fi (fi) OK

- **Customer:** Paljonko katsastus maksaa?
- **Agent:** Onko auto bensiini-, diesel- tai hybridiauto vai täyssähköauto? Sitten voin kertoa hinnan Palokassa.  _[get_station_info]_

## pilot.v7.price.ev.en (en) OK

- **Customer:** How much is an inspection?
- **Agent:** Is it a petrol, diesel or hybrid car, or fully electric?  _[get_station_info]_
- **Customer:** It is fully electric
- **Agent:** At Palokka, the electric car inspection is €46, payable at the station. Want me to find a time?  _[get_station_info]_

## pilot.v7.referent.listed_stations.en (en) OK

- **Customer:** Which stations can you book a time at?
- **Agent:** I can book appointments here at Palokka in Jyväskylä or Itäharju in Turku.  _[no tool]_
- **Customer:** What time are they open until tomorrow?
- **Agent:** Palokka and Itäharju are both open until 17:00 tomorrow.  _[get_station_info, get_station_info]_

## pilot.v7.referent.listed_stations.fi (fi) OK

- **Customer:** Millä asemilla voit varata ajan?
- **Agent:** Voin varata ajan täällä Palokkaan Jyväskylässä tai Itäharjuun Turussa. Suomenojan ajanvaraus onnistuu K1:n sivuilla tai numerosta 0306 100 100.  _[no tool]_
- **Customer:** Mihin asti ne ovat huomenna auki?
- **Agent:** Palokka ja Itäharju ovat huomenna auki klo 17 asti.  _[get_station_info, get_station_info]_

## pilot.v7.friday.reject_first.en (en) OK

- **Customer:** I want a time on Friday, as late as possible.
- **Agent:** Fri 9 Oct, the latest available time is 16:45. Would you like that?  _[get_slots]_
- **Customer:** Not that one, not 9.10.
- **Agent:** Fri 16 Oct: 09:00, 13:00 or 16:45. Which time works best?  _[get_slots]_

## pilot.v7.friday.reject_first.fi (fi) OK

- **Customer:** Haluan ajan perjantaille, mahdollisimman myöhään.
- **Agent:** Pe 9.10. Palokassa myöhäisin vapaa aika on klo 16.45. Sopisiko se?  _[get_slots]_
- **Customer:** Ei tuo käy, muttei 9.10.
- **Agent:** Pe 16.10. Palokassa vapaa aika on klo 16.45. Sopisiko se?  _[get_slots]_

## pilot.v7.measuring.ask_applies.en (en) OK

- **Customer:** Does the emissions test apply to a 1973 car? I do not think it should.
- **Agent:** Cars registered before August 1976 aren’t measured, so a 1973 car doesn’t need the emissions test. For an inspection only in Palokka, Wed 7 Oct: 09:00, 13:00 or 16:45. Which works?  _[get_slots]_
- **Customer:** Then leave the emissions test out. What times are free tomorrow?
- **Agent:** For the inspection only, with no emissions test: Wed 7 Oct at 09:00, 13:00 or 16:45. Which works for you?  _[get_slots]_

## pilot.v7.measuring.ask_applies.fi (fi) CHECK: CHECK expected reply /vapaaehtoi|voi (jättää|ottaa) pois|voidaan jättää|jättää pois|jätetään pois|ilman (mittau|päästö)|

- **Customer:** Koskeeko päästömittaus myös vuoden 1973 autoon? Ei sen pitäisi.
- **Agent:** Vuonna 1973 ensirekisteröityyn autoon ei tehdä päästömittausta, joten katsastus on nyt pelkkä tarkastus. Palokassa vapaita aikoja ke 7.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?  _[get_slots]_
- **Customer:** Jätetään mittaus pois. Mitä aikoja on huomenna?
- **Agent:** Mittaus jää pois, katsastus on pelkkä tarkastus. Huomenna ke 7.10. Palokassa vapaita aikoja klo 9.00, 13.00 tai 16.45. Mikä sopii?  _[get_slots]_

## pilot.v7.kouvola.book.fi (fi) OK

- **Customer:** Haluan varata ajan huomiselle
- **Agent:** Kouvolan Korjalan katsastusasema on huomenna auki klo 8–16, mutta en voi tehdä sinne varausta tässä chatissa. Voit varata ajan täällä: https://ajanvaraus.k1katsastus.fi/?stationId=1473&serviceId=1 tai numerosta 0306 100 100.  _[get_station_info]_
