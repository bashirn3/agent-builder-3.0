"""Automatic checks for the v2 conversation evaluation.

Anything flagged here is read by a person; a clean result is only "nothing mechanical found". Tone, friendliness and
whether the answer really helped are judged by reading the transcripts.
"""
import json
import re

BANNED = re.compile(r'google meet|google calendar|calendar invite|vuosaari|rahtarinkatu|hi@wasup|\+358\s?400|59\s?€|maksulinkki|payment link', re.I)
BULLET = re.compile(r'^\s*([-*•]|\d+[.)])\s+\S', re.M)
FI = ['ja', 'on', 'että', 'ole', 'voi', 'klo', 'aika', 'ajan', 'katsastus', 'hei', 'moi', 'sinulle', 'sopii', 'mitä', 'onko', 'kiitos', 'huomenna', 'auki', 'asema', 'minä', 'sinun', 'ei', 'kyllä', 'jos', 'tai', 'vai', 'nämä', 'tämä', 'varaus', 'varata', 'autan', 'pystyn', 'haluat', 'sopiva']
SV = ['och', 'är', 'att', 'jag', 'inte', 'kan', 'besiktning', 'hej', 'vill', 'tid', 'tiden', 'passar', 'du', 'dig', 'det', 'finns', 'öppet', 'stationen', 'kl', 'bokning', 'boka', 'tack', 'imorgon', 'eller', 'ett', 'vilken', 'hjälpa', 'gärna']
EN = ['the', 'you', 'is', 'and', 'to', 'can', 'would', 'your', 'for', 'are', 'with', 'this', 'that', 'time', 'open', 'booking', 'hi', 'hello', 'which', 'please', 'have', 'not', 'what', 'inspection', 'help', 'let', 'me']
WORD = re.compile(r"[a-zåäöÅÄÖ]+", re.I)


def detect(text):
    words = [w.lower() for w in WORD.findall(text)]
    if len(words) < 3:
        return None
    scores = {'fi': sum(w in FI for w in words), 'sv': sum(w in SV for w in words), 'en': sum(w in EN for w in words)}
    best = max(scores, key=scores.get)
    ordered = sorted(scores.values(), reverse=True)
    if ordered[0] < 2 or ordered[0] == ordered[1]:
        return None
    return best


def outputs_text(turns):
    return ' '.join(step['output'] for t in turns for step in t['steps'])


def ok_output(step):
    try:
        data = json.loads(step['output'])
    except Exception:
        return None
    if isinstance(data, list):
        data = data[0] if data else None
    return data if isinstance(data, dict) else None


def success(turns, tool):
    for t in turns:
        for step in t['steps']:
            if step['tool'] == tool:
                data = ok_output(step)
                if data and (data.get('success') or data.get('ok')) and (tool != 'book_inspection_invite' or data.get('booking_number')):
                    return data
    return None


TIME_COLON = re.compile(r'(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])')
TIME_KLO = re.compile(r'(?:klo|kl\.?|at)\s*([01]?\d|2[0-3])\.([0-5]\d)(?![\d.])', re.I)
PRICE = re.compile(r'(\d+(?:[.,]\d+)?)\s?(?:€|eur\b|euroa|euros|euro\b)', re.I)


def times_in(text):
    found = {f'{int(h):02d}:{m}' for h, m in TIME_COLON.findall(text)}
    found |= {f'{int(h):02d}:{m}' for h, m in TIME_KLO.findall(text)}
    return found


def is_sum(number, text):
    values = {float(v) for v in re.findall(r'(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)(?![\d])', text.replace(',', '.'))}
    try:
        target = float(number)
    except ValueError:
        return False
    return any(abs(a + b - target) < 0.011 for a in values for b in values if a != b or True)


def evaluate(scenario, turns):
    flags = []
    lead_lang = scenario['lead']['lang']
    langs = scenario.get('lang_turns')
    all_out = outputs_text(turns)
    user_text = ' '.join(t['user'] for t in turns)
    lead_phone_digits = re.sub(r'\D', '', scenario['lead'].get('phone', ''))
    seen_book = False
    for i, turn in enumerate(turns):
        reply = turn['reply'] or ''
        tag = f't{i + 1}'
        if turn['status'] != 200:
            flags.append(f'{tag} HTTP_{turn["status"]} {turn["error"][:80]}')
            continue
        if not reply.strip():
            flags.append(f'{tag} EMPTY')
        if turn['fallback']:
            flags.append(f'{tag} FALLBACK_REPLY')
        if len(reply) > 700:
            flags.append(f'{tag} LONG({len(reply)})')
        if '**' in reply or re.search(r'^#{1,4}\s', reply, re.M) or BULLET.search(reply):
            flags.append(f'{tag} MARKDOWN')
        if BANNED.search(reply):
            flags.append(f'{tag} BANNED:{BANNED.search(reply).group(0)}')
        if reply.count('?') > 2:
            flags.append(f'{tag} MANY_QUESTIONS({reply.count("?")})')
        expected = (langs[i] if langs and i < len(langs) else scenario.get('expect') or lead_lang)
        got = detect(reply)
        if expected and expected != 'any' and got and got != expected:
            flags.append(f'{tag} LANG expected {expected} got {got}')
        for hit in times_in(reply):
            if hit not in all_out and hit not in user_text and hit.lstrip('0') not in user_text:
                flags.append(f'{tag} UNGROUNDED_TIME {hit}')
        for amount in PRICE.findall(reply):
            number = amount.replace(',', '.')
            plain = number.rstrip('0').rstrip('.') if '.' in number else number
            if not re.search(rf'(?<![\d.]){re.escape(plain)}(?:\.0+)?(?![\d])', all_out.replace(',', '.')) and amount not in user_text and not is_sum(number, all_out):
                flags.append(f'{tag} UNGROUNDED_PRICE {amount}')
        if lead_phone_digits and lead_phone_digits[-8:] in re.sub(r'\D', '', reply):
            flags.append(f'{tag} PHONE_ECHO')
        if re.search(r'(booking number|varausnumero|bokningsnummer)\W{0,12}(is|on|är)?\W{0,3}[A-Z0-9-]*\d|booking (is )?confirmed|varaus on vahvistettu|bokningen är bekräftad', reply, re.I) and not success(turns[: i + 1], 'book_inspection_invite') and not success(turns[: i + 1], 'reschedule_booking'):
            flags.append(f'{tag} CLAIMS_BOOKED_WITHOUT_TOOL')
        for step in turn['steps']:
            data = ok_output(step)
            if step['tool'] in ('book_inspection_invite', 'reschedule_booking') and data and data.get('ok') is False:
                flags.append(f'{tag} BOOK_TOOL_FAILED {str(data.get("error"))[:80]}')
            if data and str(data.get('error', '')).startswith('unknown action'):
                flags.append(f'{tag} TOOL_ERROR unknown action')
    for check in scenario.get('checks', []):
        kind = check[0]
        used = [name for t in turns for name in t['tools']]
        replies = [t['reply'] or '' for t in turns]
        if kind == 'tool' and check[1] not in used:
            flags.append(f'CHECK expected tool {check[1]}')
        elif kind == 'any_tool' and not set(check[1]) & set(used):
            flags.append(f'CHECK expected one of tools {check[1]}')
        elif kind == 'no_success' and success(turns, check[1]):
            flags.append(f'CHECK {check[1]} succeeded')
        elif kind == 'no_tool' and check[1] in used:
            flags.append(f'CHECK unexpected tool {check[1]}')
        elif kind == 'reply' and not any(re.search(check[1], r, re.I) for r in replies):
            flags.append(f'CHECK expected reply /{check[1]}/')
        elif kind == 'no_reply' and any(re.search(check[1], r, re.I) for r in replies):
            flags.append(f'CHECK forbidden reply /{check[1]}/')
        elif kind == 'final' and not re.search(check[1], replies[-1] if replies else '', re.I):
            flags.append(f'CHECK final reply /{check[1]}/')
        elif kind == 'param':
            _, tool, key, pattern = check
            values = [p.get(key, '') for t in turns for name, p in zip(t['tools'], t['params']) if name == tool]
            if not any(re.search(pattern, v, re.I) for v in values):
                flags.append(f'CHECK {tool}.{key} /{pattern}/ not in {values}')
        elif kind == 'no_param':
            _, tool, key, pattern = check
            values = [p.get(key, '') for t in turns for name, p in zip(t['tools'], t['params']) if name == tool]
            if any(re.search(pattern, v, re.I) for v in values):
                flags.append(f'CHECK {tool}.{key} /{pattern}/ used: {values}')
        elif kind == 'booked' and not success(turns, 'book_inspection_invite'):
            flags.append('CHECK expected a successful booking')
        elif kind == 'no_book' and success(turns, 'book_inspection_invite'):
            flags.append('CHECK a booking was made')
        elif kind == 'cancelled' and not success(turns, 'cancel_booking'):
            flags.append('CHECK expected a successful cancellation')
        elif kind == 'rescheduled' and not success(turns, 'reschedule_booking'):
            flags.append('CHECK expected a successful reschedule')
        elif kind == 'no_output' and re.search(check[1], all_out, re.I):
            flags.append(f'CHECK tool output matched /{check[1]}/')
        elif kind == 'output' and not re.search(check[1], all_out, re.I):
            flags.append(f'CHECK tool output missing /{check[1]}/')
    return flags
