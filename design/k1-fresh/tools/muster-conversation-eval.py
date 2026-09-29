"""Evaluate isolated K1 n8n webhook copies; never edit the production workflow.

The evaluation webhook has a random path AND a random header key. Copies are always
deactivated and deleted on exit. Test sessions use a separate memory namespace.
"""
import concurrent.futures
import copy
import importlib.util
import json
import random
import re
import secrets
import statistics
import time
import urllib.error
import urllib.request
import uuid

NORMALIZE_REPLY_JS = r"""
const agent = $('AI Agent').first().json
const raw = agent.output || {}
const lines = Array.isArray(raw.messages) ? raw.messages : []
const messages = lines.filter((line) => typeof line === 'string').map((line) => line.trim()).filter(Boolean)
const body = $('Playground').first().json.body || {}
const text = String(body.text || '').trim()
// The old WF-2 output contract allows silent turns; the builder chat cannot display them.
// Never claim a tool succeeded from this fallback. Give a safe next step in the last language.
if (!messages.length) {
  const lang = /\b(hej|visst|tack|boka|besiktning)\b|nästa|imorgon/i.test(text) ? 'sv'
    : /\b(joo|moi|hei|kiitos|huomenna|ensi|varaa|katsastus)\b|kyllä/i.test(text) ? 'fi' : 'en'
  const ack = /^(sure|yes|yeah|yep|ok(?:ay)?|joo|kyllä|visst|ja|okej)[.! ]*$/i.test(text)
  const history = Array.isArray(body.messages) ? body.messages : []
  const lastAssistant = [...history].reverse().find((entry) => entry.role === 'assistant')?.content || ''
  const offeredTwoTimes = (String(lastAssistant).match(/\b\d{1,2}[:.]\d{2}\b/g) || []).length >= 2
  const success = (Array.isArray(agent.intermediateSteps) ? agent.intermediateSteps : []).some((step) =>
    /^(book_inspection_invite|reschedule_booking|cancel_booking|opt_out)$/.test(String(step.action?.tool || step.tool || '')))
  messages.push(success
    ? { fi: 'En saanut vahvistusta näkyviin. Tarkistetaan varauksen tila ennen kuin yrität uudelleen.',
        sv: 'Jag kunde inte visa bekräftelsen. Kontrollera bokningens status innan du försöker igen.',
        en: "I couldn't show the confirmation. Please check the booking status before trying again." }[lang]
    : ack && offeredTwoTimes
      ? { fi: 'Kumpi mainituista ajoista sopii sinulle?', sv: 'Vilken av de två tiderna passar dig?', en: 'Which of those two times works for you?' }[lang]
      : ack
        ? { fi: 'Hyvä! Mille päivälle katsotaan katsastusaikaa?', sv: 'Absolut! Vilken dag passar dig för besiktningen?', en: 'Sure! Which day would suit you for the inspection?' }[lang]
        : { fi: 'En saanut vastausta muodostettua. Voisitko sanoa sen uudelleen?', sv: 'Jag kunde inte formulera ett svar. Kan du säga det igen?', en: "I couldn't put together a reply. Could you say that again?" }[lang])
}
return [{ json: { reply: messages.join('\n\n'), fallback: !lines.some((line) => typeof line === 'string' && line.trim()) } }]
"""

spec = importlib.util.spec_from_file_location('n8n_gate', __file__.replace('muster-conversation-eval.py', 'n8n-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SOURCE = 'w8a9S1uxB5U9qnNO'
WF2 = 'q7Z8SWaiZH2QgYuC'
STYLE = """## CONVERSATIONAL K1 BEHAVIOUR — preserve WF-2's human voice
Chat like the helpful person at a K1 station, not an appointment form. Warm, informal,
brief, and responsive to the customer's actual message. Answer their human beat first:
a greeting deserves a friendly greeting, a joke may get one dry line, a frustrated
customer gets a plain apology and the next practical step. Then, if they want to book,
advance the conversation by ONE natural question for the next detail you genuinely need.
Don't simply repeat their words, pressure them, reintroduce yourself, ask already-answered
questions, or ask for all details at once. "Hey" merits more than "Hey!" when the opener
has already asked about booking: greet them, then gently offer to help find a time.
"Sure" or "yeah" replying to that opener means they want to proceed: warmly ask which
day suits them. After presenting two available slots, "sure" is NOT a choice between
them; ask which time. A sign-off can be a short warm line, never a dead empty bubble.
If no question is needed, give a concise, useful answer rather than inventing a next step.
If someone says they are under 18 or cannot legally drive, stop arranging inspection
for them; tell them a licensed adult needs to book, then wait for that adult.
Most turns: one or two WhatsApp-length bubbles, 1–2 sentences each; no canned
"I can certainly assist you" scripts or formulaic sign-offs. Sparse emoji only if natural.
All outward text stays in the customer's most recent language. The tool/booking rules
below override any example phrasing here. Never sacrifice correctness for warmth.
"""


def blend(workflow):
    config = next(n for n in workflow['nodes'] if n['name'] == '⚙️ CONFIG')
    prompt = next(a for a in config['parameters']['assignments']['assignments'] if a['name'] == 'business_prompt')
    prompt['value'] = STYLE + '\n' + prompt['value']
    agent = next(n for n in workflow['nodes'] if n['name'] == 'AI Agent')
    system = agent['parameters']['options']['systemMessage']
    system = system.replace(
        '- Silence is a valid output. An empty `messages` array with a reaction is a normal, natural turn.',
        '- For this K1 tester and customer chat, ALWAYS provide at least one meaningful text bubble. Do not output an empty messages array. On a short acknowledgement while booking is underway, move forward with the next necessary question; on a closing thanks, a short warm sign-off is enough.'
    ).replace(
        '- If they are merely acknowledging something you said, a reaction alone is usually the right answer.',
        '- If they merely acknowledge an invitation to book, treat that as consent to explore a date, NOT consent to select or book a slot. Say something warm and ask for a day.'
    ).replace(
        'Say plainly that you\'re passing it to the team.',
        'The escalation flag does not notify a team. Never claim to have passed the request to anyone; give the verified booking number or official station page when actual human action is required.'
    ).replace('which course / professional background', 'which date / registration number')
    system += "\nFINAL LANGUAGE CHECK: Before outputting messages, compare the latest user's language to EACH bubble. Swedish questions and complaints must be answered in Swedish, even if a tool, memory, or station name was Finnish. Rewrite every Finnish sentence in Swedish. Preserve station names, addresses, and booking numbers only.\n"
    agent['parameters']['options']['systemMessage'] = system
    assert 'ALWAYS provide at least one meaningful text bubble' in system


def copy_for_eval(label, secret, old=False):
    workflow = gate.request('GET', f'/workflows/{SOURCE}')
    # Never mutate the source workflow returned by the API.
    workflow = copy.deepcopy(workflow)
    if label == 'blend' and not any('CONVERSATIONAL K1 BEHAVIOUR' in a.get('value', '') for a in next(n for n in workflow['nodes'] if n['name'] == '⚙️ CONFIG')['parameters']['assignments']['assignments'] if a['name'] == 'business_prompt'):
        blend(workflow)
    if old:
        original = gate.request('GET', f'/workflows/{WF2}')
        config = next(n for n in workflow['nodes'] if n['name'] == '⚙️ CONFIG')
        old_prompt = next(a['value'] for a in next(n for n in original['nodes'] if n['name'] == '⚙️ CONFIG')['parameters']['assignments']['assignments'] if a['name'] == 'business_prompt')
        next(a for a in config['parameters']['assignments']['assignments'] if a['name'] == 'business_prompt')['value'] = old_prompt
        next(n for n in workflow['nodes'] if n['name'] == 'AI Agent')['parameters']['options']['systemMessage'] = next(n for n in original['nodes'] if n['name'] == 'AI Agent')['parameters']['options']['systemMessage']
        # WF-2's Google Calendar tools must never operate during a style/latency comparison.
        for node in workflow['nodes']:
            if node['name'] in ('get_slots', 'book_inspection_invite', 'reschedule_booking', 'cancel_booking', 'hold_slot', 'book_slot'):
                workflow['connections'].pop(node['name'], None)
    suffix = secrets.token_urlsafe(18)
    hook = next(n for n in workflow['nodes'] if n['name'] == 'Playground')
    hook['parameters']['path'] = 'k1-conversation-eval-' + suffix
    hook.pop('webhookId', None)
    turn = next(n for n in workflow['nodes'] if n['name'] == 'Playground Turn')
    turn_js = turn['parameters']['jsCode']
    turn_js = turn_js.replace(
        "'k1_katsastus_demo_' + phone.replace(/\\D/g, '')",
        "'k1_eval_" + suffix + "_' + phone.replace(/\\D/g, '') + '_chat_' + String(body.conversationId || '').replace(/[^a-zA-Z0-9-]/g, '')"
    )
    assert "'_chat_'" in turn_js and "'k1_eval_" in turn_js, 'test memory namespace was not isolated'
    turn['parameters']['jsCode'] = (
        "if (String($('Playground').first().json.headers?.['x-k1-eval-key'] || '') !== "
        + json.dumps(secret) + ") throw new Error('Unauthorized evaluation');\n" + turn_js
    )
    # Normalize before persistence so both the saved conversation and HTTP reply use identical text.
    normalizer = next((node for node in workflow['nodes'] if node['name'] == 'Normalize playground reply'), None)
    if normalizer is None:
        normalizer = {'id': str(uuid.uuid4()), 'name': 'Normalize playground reply', 'type': 'n8n-nodes-base.code',
                      'typeVersion': 2, 'position': [-2600, 640], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': NORMALIZE_REPLY_JS}}
        workflow['nodes'].append(normalizer)
        workflow['connections']['Playground call?']['main'][0] = [{'node': normalizer['name'], 'type': 'main', 'index': 0}]
        workflow['connections'][normalizer['name']] = {'main': [[{'node': 'Record playground turn', 'type': 'main', 'index': 0}]]}
    # No test conversations or empty assistant messages are written to the approved builder history.
    record = next(n for n in workflow['nodes'] if n['name'] == 'Record playground turn')
    record['type'] = 'n8n-nodes-base.code'
    record['typeVersion'] = 2
    record.pop('credentials', None)
    record.pop('onError', None)
    record['parameters'] = {'mode': 'runOnceForAllItems', 'jsCode': 'return [{ json: { recorded: false } }]'}
    workflow['connections']['Playground'] = {'main': [[{'node': 'Playground Turn', 'type': 'main', 'index': 0}]]}
    reply = next(n for n in workflow['nodes'] if n['name'] == 'Playground reply')
    reply['parameters']['jsCode'] = reply['parameters']['jsCode'].replace("  reply: messages.join('\\n\\n'),", "  reply: $('Normalize playground reply').first().json.reply,")
    assert "$('Normalize playground reply').first().json.reply" in reply['parameters']['jsCode']
    # No actual WhatsApp/test inbound messages can arrive on the unrelated copied webhook.
    inbound = next(n for n in workflow['nodes'] if n['name'] == 'Webhook')
    inbound['parameters']['path'] = 'k1-eval-inbound-' + suffix
    inbound.pop('webhookId', None)
    settings = {**workflow['settings'], 'saveDataSuccessExecution': 'all', 'saveDataErrorExecution': 'all'}
    payload = {'name': 'K1 evaluation ' + label + ' ' + suffix[:6], 'nodes': workflow['nodes'], 'connections': workflow['connections'], 'settings': settings}
    created = gate.request('POST', '/workflows', payload)
    gate.request('POST', f"/workflows/{created['id']}/activate")
    url = gate.local_env().get('N8N_RAPID_BASE_URL', gate.DEFAULT_BASE) + '/webhook/' + hook['parameters']['path']
    # n8n webhook registration can lag activation. A 404 here is route propagation,
    # not an agent failure; verify readiness BEFORE starting the measured test batch.
    for _ in range(12):
        probe = urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(probe, timeout=5):
                break
        except urllib.error.HTTPError as error:
            if error.code != 404:
                break
        time.sleep(1)
    else:
        raise RuntimeError('evaluation webhook did not register after activation')
    return created['id'], url


def request(url, secret, text, index, timeout=110, conversation_id=None, phone=None, history=None):
    language = 'sv' if re.search(r'\b(hej|visst|jag|besiktning)\b|nästa', text, re.I) else 'fi' if re.search(r'\b(joo|moi|hei|ensi|katsastus)\b|kyllä', text, re.I) else 'en'
    opener = {'fi': 'Hei! Autan mielelläni katsastusajan löytämisessä. Mille päivälle katsotaan?',
              'sv': 'Hej! Jag hjälper dig gärna att hitta en tid för besiktningen. Vilken dag passar?',
              'en': 'Hi! I can help you find an inspection time. Which day works for you?'}[language]
    payload = {'text': text, 'messages': (history or []) + [{'role': 'user', 'content': text}], 'phone': phone or f'358999{index:08d}', 'stationId': 256 if index % 2 == 0 else 241,
               'leadContext': f'Plate EVAL-{index:04d}. Station {"Jyväskylä Palokka" if index % 2 == 0 else "Turku Itäharju"}. Language determined by customer.',
               'conversationId': conversation_id or str(uuid.uuid4()), 'versionId': None, 'isDraft': True, 'opener': opener}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'x-k1-eval-key': secret}, method='POST')
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.load(response)
            status = response.status
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        data = {'error': type(exc).__name__ + ': ' + str(exc)[:120]}
        status = getattr(exc, 'code', 0)
    return {'index': index, 'input': text, 'latency': round(time.monotonic() - started, 2), 'status': status,
            'reply': data.get('reply', '') if isinstance(data, dict) else '',
            'tools': [t['name'] for t in data.get('toolCalls', [])] if isinstance(data, dict) and isinstance(data.get('toolCalls'), list) else [],
            'error': data.get('error', '') if isinstance(data, dict) else ''}


CASES = {
    'en': ['hey', 'sure', 'yes, I would like to book', 'How are you?', 'Next week would work', 'Tomorrow?', 'Monday', 'I can do Tuesday afternoon', 'Is 8:30 available?', 'What is the price?', 'Where are you located?', 'What are your opening hours?', 'Can you send a booking link?', 'I have a different car', 'No email, can you still book?', 'Please cancel my booking', 'I need to move my booking', 'Please stop messaging me', 'I am 13', 'You texted me first, why?', 'Speak to a person', 'thanks, bye', 'I am upset about my inspection', 'Sure, book one of those two times', 'Do you have weekend slots?'],
    'fi': ['moi', 'joo', 'haluaisin varata ajan', 'Mitä kuuluu?', 'Ensi viikolla käy', 'Entä huomenna?', 'Maanantai sopii', 'Tiistai iltapäivällä', 'Onko klo 8.30 vapaa?', 'Mitä katsastus maksaa?', 'Missä te olette?', 'Mitkä ovat aukioloajat?', 'Onko varauslinkkiä?', 'Auto on vaihtunut', 'Ei ole sähköpostia, onnistuuko varaus?', 'Peruuta varaukseni', 'Haluan siirtää varauksen', 'Älä enää viestittele', 'Olen 13-vuotias', 'Miksi lähetitte minulle viestin?', 'Saisinko ihmisen apua?', 'Kiitti moi', 'Olen pettynyt palveluun', 'Joo, varaa joku noista kahdesta', 'Onko viikonlopulle aikoja?'],
    'sv': ['hej', 'visst', 'jag vill boka tid', 'Hur mår du?', 'Nästa vecka passar', 'Imorgon då?', 'Måndag passar', 'Tisdag eftermiddag', 'Finns det en tid 8.30?', 'Vad kostar besiktningen?', 'Var ligger stationen?', 'Vilka är öppettiderna?', 'Har ni en bokningslänk?', 'Jag har en annan bil', 'Kan ni boka utan e-post?', 'Avboka min tid', 'Jag vill ändra min bokning', 'Sluta skicka meddelanden', 'Jag är 13 år', 'Varför skrev ni till mig?', 'Kan jag prata med en människa?', 'Tack och hej', 'Jag är besviken', 'Okej, boka en av de två tiderna', 'Har ni tider på helger?'],
}


def validate(row, lang):
    reply = row['reply'] if isinstance(row['reply'], str) else ''
    low = reply.lower()
    failures = []
    if row['status'] != 200:
        failures.append('HTTP_' + str(row['status']))
    if not reply.strip():
        failures.append('EMPTY')
    if re.search(r'google meet|google calendar|vuosaari|59\s*€|rahtarinkatu|hi@wasup|\+358\s*400', low):
        failures.append('OLD_FACTS')
    if lang == 'sv' and re.search(r'\b(meillä|en pysty|varaus|kiitos|sopii|asemalle)\b', low):
        failures.append('MIXED_SV')
    if len(reply) > 650:
        failures.append('LONG')
    if any(word in row['input'].lower() for word in ('sure', 'joo', 'visst', 'okej, boka')) and 'book_inspection_invite' in row['tools']:
        failures.append('BOOKED_WITHOUT_SLOT')
    if 'cancel_booking' in row['tools'] and 'booking' not in row['input'].lower() and 'varau' not in row['input'].lower() and 'tid' not in row['input'].lower():
        failures.append('UNEXPECTED_CANCEL')
    return failures


def main():
    secret = secrets.token_urlsafe(26)
    copies = []
    try:
        urls = {}
        for label, old in [('blend', False), ('current', False), ('wf2_style', True)]:
            ident, url = copy_for_eval(label, secret, old)
            copies.append(ident)
            urls[label] = url
            print('created', label, ident, flush=True)
        # Small paired controls first. WF-2 style uses no live booking tools.
        prompts = ['hey', 'sure', 'How are you?', 'I would like to book', 'moi', 'joo', 'hej', 'visst']
        for label in ('wf2_style', 'current', 'blend'):
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                rows = list(pool.map(lambda item: request(urls[label], secret, item[1], item[0]), enumerate(prompts, 1)))
            print('CONTROL', label, json.dumps(rows, ensure_ascii=False), flush=True)
        # Deterministic 200-case matrix: 75 basic multilingual scenarios + 125 varied paraphrases.
        corpus = [(lang, case) for lang, cases in CASES.items() for case in cases]
        variants = [('en', 'Hi — '), ('fi', 'Hei, '), ('sv', 'Hej, '), ('en', 'Quick question: '), ('fi', 'Kysymys: ')]
        extras = [(lang, prefix + case) for lang, prefix in variants for case in CASES[lang]]
        matrix = corpus + extras
        assert len(matrix) == 200, len(matrix)
        random.Random(42).shuffle(matrix)
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            futures = [pool.submit(request, urls['blend'], secret, text, 1000 + i) for i, (lang, text) in enumerate(matrix)]
            results = []
            for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
                row = future.result()
                lang = matrix[row['index'] - 1000][0]
                row['lang'] = lang
                row['failures'] = validate(row, lang)
                results.append(row)
                if i % 25 == 0:
                    print('progress', i, 'failures', sum(bool(r['failures']) for r in results), 'elapsed', round(time.monotonic() - started, 1), flush=True)
        results.sort(key=lambda r: r['index'])
        print('RESULT', json.dumps({'count': len(results), 'success': sum(not r['failures'] for r in results), 'p50': statistics.median(r['latency'] for r in results),
                                    'p95': sorted(r['latency'] for r in results)[189], 'failures': [r for r in results if r['failures']],
                                    'sample': [r for r in results[:12]]}, ensure_ascii=False), flush=True)
        followups = ['Olen 13-vuotias', 'I am 13', 'Jag är 13 år', 'Yes please, tomorrow', 'Sure, what times do you have next Monday?', 'Can you cancel my booking EVAL-9999?', 'What is the booking price?']
        rows = [request(urls['blend'], secret, text, 3000 + i) for i, text in enumerate(followups)]
        print('FOLLOWUPS', json.dumps(rows, ensure_ascii=False), flush=True)
        # Multi-turn booking is tested separately with explicit cancellation/verification;
        # never let a batch evaluator leave a real staging reservation behind.
    finally:
        for ident in reversed(copies):
            try:
                try:
                    gate.request('POST', f'/workflows/{ident}/deactivate')
                except urllib.error.HTTPError as exc:
                    if exc.code != 409:
                        raise
                for attempt in range(8):
                    try:
                        gate.request('DELETE', f'/workflows/{ident}')
                        print('removed', ident, flush=True)
                        break
                    except urllib.error.HTTPError as exc:
                        if exc.code != 409 or attempt == 7:
                            raise
                        time.sleep(1)
            except Exception as exc:
                print('CLEANUP FAILED', ident, type(exc).__name__, str(exc)[:120], flush=True)


if __name__ == '__main__':
    main()
