#!/usr/bin/env python3
"""K1 Katsastus as a Parlant agent: the shadow pilot. The same rules as the n8n agent, loaded from prompts/k1-guidelines.yaml.

  K1_PARLANT_NLP=azure python3 parlant/k1_agent.py        serve on :8800 (Parlant REST API plus /k1/lead and /k1/steps)

What maps where:
- core catalog rules       guidelines that always match (MATCH_ALWAYS): tool truth, language, voice
- conditional rules        Parlant guidelines (condition, action), matched per turn; only the matching ones reach the reply
- excludes / depends_on    prioritize_over / depend_on relationships
- booking flow             a Journey: find times, offer, pick, name, book, confirm
- stations and products    glossary terms
- opt-out confirmations    canned responses, so their wording cannot drift
- lead context             a variable filled per session by the eval (or later by the WhatsApp bridge)

NLP: K1_PARLANT_NLP = azure (AZURE_ENDPOINT, AZURE_GENERATIVE_MODEL_NAME, AZURE_EMBEDDING_MODEL_NAME and its _DIMS and
_WINDOW, optional K1_EMBED_ENDPOINT; AZURE_API_KEY or an `az login` session), openai (OPENAI_API_KEY) or anthropic
(ANTHROPIC_API_KEY).
"""
import asyncio
import os
import sys
from pathlib import Path

import parlant.sdk as p
import yaml
from fastapi import FastAPI
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import k1_tools as tools  # noqa: E402

CATALOG = HERE.parent / 'prompts/k1-guidelines.yaml'
AGENT_NAME = 'K1 Katsastus'

TOOLS_FOR = {
    'flow.consent_offers_times': ['get_slots'], 'flow.week_without_day': ['get_slots'], 'flow.closed_day_next_open': ['get_slots'],
    'flow.part_of_day': ['get_slots'], 'flow.pick': ['get_slots'], 'flow.dated_offers': ['get_slots'], 'times.reject_date': ['get_slots'],
    'times.slots': ['get_slots'], 'stations.latest_time': ['get_slots'], 'measuring.leave_out': ['get_slots'], 'vehicle.other_vehicle': ['get_slots'],
    'bookings.slot_unavailable': ['get_slots'],
    'flow.book_and_confirm': ['book_inspection_invite'], 'flow.names': ['book_inspection_invite'], 'times.book_it': ['book_inspection_invite'],
    'flow.rename': ['cancel_booking', 'get_slots', 'book_inspection_invite'],
    'measuring.change_booked': ['get_my_bookings', 'cancel_booking', 'get_slots', 'book_inspection_invite'],
    'bookings.lookup_first': ['get_my_bookings', 'cancel_booking', 'reschedule_booking', 'get_slots'],
    'stations.hours': ['get_station_info'], 'stations.hours_status': ['get_station_info'], 'stations.referent': ['get_station_info'],
    'scope.lead_not_bookable': ['get_station_info'], 'scope.lives_elsewhere': ['get_station_info'], 'prices.rules': ['get_station_info'],
    'info.faq': ['faq_lookup'],
    'optout.when': ['opt_out'], 'optout.with_booking': ['opt_out', 'get_my_bookings', 'cancel_booking'],
    'escalation.when': ['escalate_to_human'],
}
CRITICALITY = {1: p.Criticality.HIGH, 2: p.Criticality.HIGH, 3: p.Criticality.MEDIUM, 4: p.Criticality.MEDIUM}

GLOSSARY = [
    ('Palokka', 'K1 Katsastus Jyväskylä Palokka, station 256. One of the two stations bookable in this chat.', ['Palokan', 'Jyväskylä Palokka']),
    ('Itäharju', 'K1 Katsastus Turku Itäharju, station 241. One of the two stations bookable in this chat.', ['Itäharjun', 'Turku Itäharju']),
    ('0306 100 100', 'K1\'s national booking phone service, Mon–Fri 07:30–18:00, Sat 09:00–14:00. Not a station\'s opening hours.', ['booking phone', 'ajanvaraus']),
    ('004', 'Periodic inspection of a car or van up to 3500 kg with a combustion engine (petrol, diesel, hybrid, gas); booked with statutory measuring 0020.', ['määräaikaiskatsastus']),
    ('0040', 'Periodic inspection of a camper or larger car (M1, up to 3500 kg), booked with measuring; not offered at every station.', ['matkailuauto', 'husbil']),
    ('004e', 'Periodic inspection of a fully electric car; no measuring.', ['sähköauto', 'elbil']),
    ('statutory measuring', 'Lakisääteiset mittaukset, the emissions or OBD test (0020). For combustion engines, included by default, optional, never for electric cars; cars registered before August 1976 are not measured.', ['lakisääteiset mittaukset', 'päästömittaus', 'avgasmätning', 'emission test']),
    ('Etuaika', 'Advance-payment option on K1\'s own booking page.', []),
    ('Muistakatsastus', 'The inspection reminder service.', []),
    ('slot_id', 'The identifier of a free time returned by get_slots (K1-YYYYMMDD-HHMM). Only these can be booked.', []),
]
OPT_OUT_CANNED = {
    'inspected': ['Hienoa, kiitos tiedosta! Lopetin muistutukset tälle autolle.', 'Great, thanks for letting us know! I\'ve stopped the reminders for this car.',
                  'Vad bra, tack för att du sa till! Jag har stoppat påminnelserna för den här bilen.'],
    'stop': ['Lopetin muistutukset, et saa niitä enää.', 'I\'ve stopped the reminders, you won\'t get any more.', 'Jag har stoppat påminnelserna, du får inga fler.'],
    'already': ['Muistutukset on jo lopetettu, et saa niitä enää.', 'The reminders are already stopped, you won\'t get any more.', 'Påminnelserna är redan stoppade, du får inga fler.'],
}


def text(value):
    return ' '.join(str(value or '').split())


async def build_guidelines(agent, catalog):
    made = {}
    canned = {key: [await agent.create_canned_response(template=line) for line in lines] for key, lines in OPT_OUT_CANNED.items()}
    for rule in catalog['guidelines']:
        examples = rule.get('examples') or {}
        action = text(rule['action'])
        if examples:
            action += ' Examples (format only, facts come from tools): ' + '; '.join(f'"{line}"' for lines in examples.values() for line in lines)
        kwargs = dict(action=action, id=None, criticality=CRITICALITY[rule['priority']], tools=[tools.ALL[name] for name in TOOLS_FOR.get(rule['id'], [])],
                      metadata={'k1_rule': rule['id'], 'priority': rule['priority']}, labels=[rule['section']])
        if rule['id'].startswith('optout.when'):
            kwargs['canned_responses'] = [*canned['inspected'], *canned['stop'], *canned['already']]
        if rule.get('core'):
            made[rule['id']] = await agent.create_guideline(condition=f'always ({rule["section"]} rule {rule["id"]})', matcher=p.MATCH_ALWAYS, **kwargs)
        else:
            made[rule['id']] = await agent.create_guideline(condition=text(rule['condition']), **kwargs)
    for rule in catalog['guidelines']:
        for other in rule.get('excludes') or []:
            await made[rule['id']].prioritize_over(made[other])
        for other in rule.get('depends_on') or []:
            await made[rule['id']].depend_on(made[other])
    return made


async def build_booking_journey(agent):
    journey = await agent.create_journey(
        title='Book an inspection',
        description='The three-message booking at Palokka or Itäharju: offer times, the customer picks one, ask for the name, book, confirm.',
        conditions=['The customer wants to book an inspection, asks for free times, or agrees to the offer to find a time, and the station can be booked in this chat (Palokka or Itäharju)'],
    )
    find = await journey.initial_state.transition_to(
        tool_state=tools.ALL['get_slots'],
        tool_instruction='From tomorrow for 7 days, or the day, week or part of the day the customer named; station empty for their own station.')
    offer = await find.target.transition_to(chat_state='Offer up to three listed times from the first day that has free times, with weekday and date, in one short line, and ask which one. No lead-in, no price.')
    await offer.target.transition_to(condition='The customer asks for another day, week or part of the day', state=find.target)
    ask_name = await offer.target.transition_to(condition='The customer picked one of the listed times or a time that is free',
                                                chat_state='State the pick (weekday, date, time, plate) and ask only for the name, in one message.')
    book = await ask_name.target.transition_to(condition='The customer gave a name', tool_state=tools.ALL['book_inspection_invite'],
                                               tool_instruction='start_time is the slot_id of the chosen time, time is its clock time, name exactly as given.')
    confirm = await book.target.transition_to(condition='The booking succeeded',
                                              chat_state='Confirm from the tool result: weekday, date, time, the station name, the booking number and the total price, payable at the station.')
    await confirm.target.transition_to(state=p.END_JOURNEY)
    retry = await book.target.transition_to(condition='The tool says the time was just taken (slot_unavailable)',
                                            chat_state='Say in one friendly sentence that the time was just taken and nothing was booked.')
    await retry.target.transition_to(state=find.target)
    name_again = await book.target.transition_to(condition='The tool says the name is not a person\'s name',
                                                 chat_state='Ask once, in one short sentence that says why, for the real name.')
    await name_again.target.transition_to(condition='The customer gave a name', state=book.target)
    return journey


class LeadRegistration(BaseModel):
    session_id: str
    lead: dict
    booking_url: str
    secret: str
    lead_context: str = ''


async def configure_api(app: FastAPI) -> None:
    @app.post('/k1/lead')
    async def register_lead(body: LeadRegistration):
        tools.register(body.session_id, body.lead, body.booking_url, body.secret, body.lead_context)
        return {'ok': True}

    @app.get('/k1/steps')
    async def read_steps(session_id: str, offset: int = 0):
        return {'steps': tools.steps_since(session_id, offset)}


def azure_service(container):
    """Parlant's Azure service, adjusted for gpt-6 deployments and for embeddings that live on another resource.

    gpt-6 models reject temperature, max_tokens and logit_bias, and tiktoken does not know their names yet.
    K1_EMBED_ENDPOINT points the embedder at a second Azure resource (the generative one has no embedding deployment).
    """
    import tiktoken
    from parlant.adapters.nlp import azure_service as az

    az.AzureSchematicGenerator.unsupported_params_by_model.setdefault('gpt-6', ['temperature', 'max_tokens', 'logit_bias'])
    known = tiktoken.encoding_for_model

    def encoding_for_model(name):
        try:
            return known(name)
        except KeyError:
            return tiktoken.get_encoding('o200k_base')
    az.tiktoken.encoding_for_model = encoding_for_model

    service = p.NLPServices.azure(container)
    embed_endpoint = os.environ.get('K1_EMBED_ENDPOINT')
    if embed_endpoint:
        # Parlant resolves embedders by class from the container, so the instance is registered under its own class.
        class K1AzureEmbedder(az.CustomAzureEmbedder):
            pass
        main = os.environ['AZURE_ENDPOINT']
        os.environ['AZURE_ENDPOINT'] = embed_endpoint
        try:
            embedder = K1AzureEmbedder(service.logger, service._tracer, service._meter)
        finally:
            os.environ['AZURE_ENDPOINT'] = main
        container[K1AzureEmbedder] = embedder

        async def get_embedder(hints={}):
            return embedder
        service.get_embedder = get_embedder
    return service


def nlp_service():
    choice = os.environ.get('K1_PARLANT_NLP', 'azure')
    return {'azure': azure_service, 'openai': p.NLPServices.openai, 'anthropic': p.NLPServices.anthropic}[choice]


async def main():
    catalog = yaml.safe_load(CATALOG.read_text())
    async with p.Server(nlp_service=nlp_service(), configure_api=configure_api, port=int(os.environ.get('K1_PARLANT_PORT', '8800'))) as server:
        agent = await server.create_agent(
            name=AGENT_NAME,
            description=text(catalog['agent']['intro']) + ' ' + text(catalog['agent']['precedence']),
            composition_mode=p.CompositionMode.FLUID,
            perceived_performance_policy=p.NullPerceivedPerformancePolicy(),
        )
        await agent.create_variable(name='lead_context', description='The lead this reminder was sent for and the current Helsinki date', tool=tools.get_lead_context)
        for name, description, synonyms in GLOSSARY:
            await agent.create_term(name=name, description=description, synonyms=synonyms)
        await build_guidelines(agent, catalog)
        await build_booking_journey(agent)
        print(f'K1 Parlant agent ready: {len(catalog["guidelines"])} guidelines, 1 journey, {len(GLOSSARY)} terms', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
