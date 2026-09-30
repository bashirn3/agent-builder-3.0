#!/usr/bin/env python3
"""Turns an evaluation results file into readable transcripts.

  python3 k1-transcripts.py [results.json]     writes result/transcripts/k1-all-conversations.txt (every conversation)
                                               and result/transcripts/k1-selected-conversations.pdf (a curated selection)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tests/v2-results-v5-all.json'
OUT = ROOT / 'result/transcripts'
LANG = {'fi': 'Finnish', 'sv': 'Swedish', 'en': 'English'}
OPENER = {'fi': 'Hei! Täällä K1 Katsastus. Autosi {plate} katsastusaika lähestyy. Haluatko, että etsin sinulle sopivan ajan?',
          'sv': 'Hej! Det är K1 Katsastus. Det är snart dags att besikta bilen {plate}. Vill du att jag hjälper dig hitta en tid?',
          'en': "Hi! It's K1 Katsastus. Your car {plate} is due for inspection soon. Want me to find a time that works for you?"}

SELECTED = [
    ('Short answers and greetings (no filler, no echo)', ['voice.ack.en.0', 'voice.ack.en.5', 'voice.ack.fi.0', 'voice.ack.fi.5', 'voice.ack.sv.0', 'voice.greet.fi.0', 'voice.greet.en.2']),
    ('Booking look-up, cancel and move (get_my_bookings)', ['voice.mine.after_booking.en', 'voice.mine.none.en', 'voice.mine.cancel.en', 'voice.mine.cancel.fi', 'voice.mine.move.en', 'voice.mine.cancel_none.sv', 'voice.mine.move_none.fi']),
    ('Everyday booking flows', ['book_then_move.fi', 'book_then_cancel.fi', 'leads.pal.book_default.fi', 'leads.ita.book_default.en', 'leads.pal.other_station.sv']),
    ('Times, prices, hours, vehicle type', ['final.times.1', 'final.times.3', 'final.prices.1', 'final.prices.2', 'final.measuring.2', 'final.vehicle.2', 'final.stations.2', 'final.stations.4']),
    ('Language switches', ['rigor.ping_pong', 'rigor.sv_lead_fi_bare_2', 'rigor.en_in_fi_lead', 'devil.x.inj.translate_fi']),
    ('Safety: ownership, injection, false promises', ['devil.cancel_foreign_event.en', 'devil.move_foreign_event', 'rigor.other_phone', 'devil.inject_en', 'devil.x.inj.developer', 'devil.x.trap.guarantee_pass', 'devil.x.trap.card_number', 'devil.x.trap.payment_link']),
    ('Awkward and off-topic input', ['devil.x.off.dating', 'devil.x.date.past_hour_today', 'devil.x.fuzz.json_obj', 'devil.x.book.name.4', 'devil.slot_taken.en', 'devil.x.turns.angry_escalation', 'devil.x.opt.stop_en']),
]


def load():
    data = json.loads(SOURCE.read_text())
    return data['results'] if isinstance(data, dict) else data


def tools_of(turn):
    names = [step['tool'] for step in turn.get('steps', [])]
    return f"  [tools: {', '.join(names)}]" if names else ''


def as_text(item, index=None):
    lead = item['lead']
    head = f"{item['id']}   suite={item['suite']}   language={LANG.get(lead['lang'], lead['lang'])}   station={lead['station']}   plate={lead['plate']}"
    lines = [head, 'result: ' + ('OK' if not item['flags'] else 'FLAGGED ' + '; '.join(item['flags']))]
    if item.get('note'):
        lines.append('note: ' + item['note'])
    lines += ['', 'Agent (opener): ' + OPENER[lead['lang']].format(plate=lead['plate'])]
    for turn in item['turns']:
        lines.append('Customer: ' + str(turn['user']).strip())
        lines.append('Agent: ' + (str(turn['reply']).strip() or '(no reply)') + tools_of(turn))
    return '\n'.join(lines)


def write_txt(results):
    OUT.mkdir(parents=True, exist_ok=True)
    flagged = sum(1 for item in results if item['flags'])
    header = [f'K1 agent conversations: {len(results)} test conversations, {len(results) - flagged} clean, {flagged} flagged by the automatic checks',
              'Customers are scripted or rule-based test customers; every booking made was cancelled afterwards. [tools: ...] lists what the agent called in that turn.', '=' * 100]
    body = ['\n\n'.join([as_text(item), '-' * 100]) for item in results]
    path = OUT / 'k1-all-conversations.txt'
    path.write_text('\n'.join(header) + '\n\n' + '\n\n'.join(body) + '\n', encoding='utf-8')
    return path


def write_pdf(results):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer

    pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
    pdfmetrics.registerFont(TTFont('DejaVu-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    registerFontFamily('DejaVu', normal='DejaVu', bold='DejaVu-Bold', italic='DejaVu', boldItalic='DejaVu-Bold')
    base = ParagraphStyle('base', fontName='DejaVu', fontSize=9, leading=12.5, alignment=TA_LEFT)
    title = ParagraphStyle('title', parent=base, fontName='DejaVu-Bold', fontSize=18, leading=22, spaceAfter=6)
    section = ParagraphStyle('section', parent=base, fontName='DejaVu-Bold', fontSize=13, leading=17, spaceBefore=6, spaceAfter=8, textColor=colors.HexColor('#0b3d2e'))
    meta = ParagraphStyle('meta', parent=base, fontSize=7.5, leading=10, textColor=colors.HexColor('#666666'))
    customer = ParagraphStyle('customer', parent=base, leftIndent=0, backColor=colors.HexColor('#eef2f7'), borderPadding=(3, 4, 3, 4), spaceBefore=5)
    agent = ParagraphStyle('agent', parent=base, leftIndent=18, backColor=colors.HexColor('#e6f4ea'), borderPadding=(3, 4, 3, 4), spaceBefore=5)
    tool = ParagraphStyle('tool', parent=meta, leftIndent=18)

    def clean(text):
        text = str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>')
        text = text.replace('👍', '[thumbs up]').replace('😄', '[smile]').replace('😅', '[sweat smile]').replace('🙏', '[thanks]').replace('👋', '[wave]').replace('😂', '[laughing]')
        return re.sub(r'[^\u0000-\u024F\u2010-\u2027\u20AC\u2190-\u21FF]', '?', text)

    index = {item['id']: item for item in results}
    story = [Paragraph('K1 Katsastus booking agent: example conversations', title),
             Paragraph('Selected from 692 automated test conversations (Finnish, Swedish, English) run against the live workflows on the Muster staging chain. '
                       'The customers are scripted test customers. Every test booking was cancelled afterwards. Grey lines show which tools the agent called.', base), Spacer(1, 8)]
    for heading, ids in SELECTED:
        story.append(Paragraph(clean(heading), section))
        for wanted in ids:
            item = index.get(wanted)
            if not item:
                continue
            lead = item['lead']
            block = [Paragraph(f"{clean(item['id'])} · {LANG.get(lead['lang'])} · {clean(lead['station'])}", meta),
                     Paragraph('<b>Agent</b> ' + clean(OPENER[lead['lang']].format(plate=lead['plate'])), agent)]
            for turn in item['turns']:
                block.append(Paragraph('<b>Customer</b> ' + clean(str(turn['user']).strip()[:600]), customer))
                block.append(Paragraph('<b>Agent</b> ' + clean(str(turn['reply']).strip() or '(no reply)'), agent))
                names = [step['tool'] for step in turn.get('steps', [])]
                if names:
                    block.append(Paragraph('tools: ' + clean(', '.join(names)), tool))
            block += [Spacer(1, 6), HRFlowable(width='100%', thickness=0.4, color=colors.HexColor('#cccccc')), Spacer(1, 8)]
            story.append(KeepTogether(block[:6]))
            story.extend(block[6:])
    path = OUT / 'k1-selected-conversations.pdf'
    SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title='K1 agent example conversations').build(story)
    return path


if __name__ == '__main__':
    results = load()
    print(write_txt(results))
    print(write_pdf(results))
