"""Builds an exhaustive list of K1 Katsastus stations with date-specific opening hours.

Sources (all read-only):
  1. www.k1katsastus.fi sitemap -> /asema/<slug>/ pages: address, booking stationId, rolling hours table.
  2. Tomi's reminders API (x-api-key): station names customers were last inspected at, incl. closed ones.
  3. Muster staging chain 91 /Stations: the only stations bookable in staging (K1 256 and 241).

Usage:
  python3 k1-stations.py [output.json]

The reminders sweep needs K1_REMINDERS_API_KEY in the environment or the ignored .env.local.
Only station names are kept from the reminders API; customer fields are discarded immediately.
"""
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request

SITE = 'https://www.k1katsastus.fi'
MUSTER = 'https://staging-booking-api.muster.fi/v3/91/Stations'
REMINDERS = 'https://tradeka-cloudtestcore-agent.frendsapp.com/api/inspectionreminder/v1/inspectionsreminders'


def fetch(url, headers=None, timeout=90):
    req = urllib.request.Request(url, headers={'User-Agent': 'k1-agent-builder/1.0', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode('utf8')


def env_key():
    if os.environ.get('K1_REMINDERS_API_KEY'):
        return os.environ['K1_REMINDERS_API_KEY']
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '.env.local'))
    if os.path.isfile(path):
        for line in open(path):
            if line.startswith('K1_REMINDERS_API_KEY='):
                return line.strip().split('=', 1)[1]
    return None


def slug(name):
    name = re.sub(r'^(SULJETTU\s+)?K1\s+(Katsastus\s+)?', '', name, flags=re.I).lower()
    for a, b in (('ä', 'a'), ('ö', 'o'), ('å', 'a')):
        name = name.replace(a, b)
    return re.sub(r'[^a-z0-9]+', '-', name).strip('-')


def text(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def station_urls():
    sitemap = fetch(SITE + '/sitemap_index.xml')
    return sorted({u for u in re.findall(r'<loc>([^<]+)</loc>', sitemap) if '/asema/' in u})


def parse_station(url):
    page = fetch(url)
    title = text(re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S).group(1)) if re.search(r'<h1', page) else ''
    address = re.search(r'</h1>\s*<[^>]*>\s*([^<]*\d{5}[^<]*)<', page, re.S)
    booking = re.search(r'ajanvaraus\.k1katsastus\.fi/\?stationId=(\d+)', page)
    block = re.search(r'id=opening-hours>(.*?)</section>', page, re.S)
    services = {}
    if block:
        for name, table in re.findall(r'<h3>(.*?)</h3>\s*<table>(.*?)</table>', block.group(1), re.S):
            rows = []
            for date, weekday, hours in re.findall(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>', table, re.S):
                d, m, y = (int(x) for x in text(date).split('.'))
                rows.append({'date': dt.date(y, m, d).isoformat(), 'weekday': text(weekday), 'hours': text(hours)})
            services[text(name)] = rows
    tel = sorted({t for t in re.findall(r'href=["\']?tel:([0-9+]+)', page) if t != '0306100100'})
    mail = sorted(set(re.findall(r'mailto:([^"\'> ]+)', page)))
    return {
        'slug': url.rstrip('/').split('/')[-1], 'url': url, 'title': title,
        'address': text(address.group(1)) if address else '',
        'k1_booking_station_id': int(booking.group(1)) if booking else None,
        'station_phone': tel, 'station_email': mail,
        'hours_by_service': services,
        'closed_on_site': url.rstrip('/').split('/')[-1].startswith('suljettu-'),
    }


def reminder_stations(key, start=dt.date(2026, 1, 1), end=dt.date(2027, 3, 1)):
    windows, cur = [], start
    while cur < end:
        stop = cur + dt.timedelta(days=13)
        windows.append((cur.isoformat(), stop.isoformat()))
        cur = stop + dt.timedelta(days=1)

    def one(window):
        url = f'{REMINDERS}?startDate={window[0]}&endDate={window[1]}&companyCode=3'
        for _ in range(3):
            try:
                rows = json.loads(fetch(url, {'x-api-key': key}))
                return {(r.get('StationName'), r.get('IsClosed')) for r in rows}
            except Exception:
                continue
        return set()

    names = {}
    with cf.ThreadPoolExecutor(8) as pool:
        for found in pool.map(one, windows):
            for name, closed in found:
                names[name] = bool(closed)
    return names


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'k1-stations.json'
    with cf.ThreadPoolExecutor(8) as pool:
        stations = list(pool.map(parse_station, station_urls()))
    muster = {s['id']: s for s in json.loads(fetch(MUSTER)) if s['name'].startswith('K1')}
    by_slug = {s['slug'].replace('suljettu-', ''): s for s in stations}
    for m in muster.values():
        match = by_slug.get(slug(m['name']))
        if match:
            match['muster_station_id'] = m['id']
            match['muster_phone'] = m['phoneNumber']
            match['muster_email'] = m['email']
    key = env_key()
    reminders = reminder_stations(key) if key else {}
    known = set(by_slug)
    extra = {slug(n): {'reminder_name': n, 'closed': c} for n, c in reminders.items() if slug(n) not in known}
    for s in stations:
        s['seen_in_reminders'] = any(slug(n) == s['slug'].replace('suljettu-', '') for n in reminders) if reminders else None
    result = {
        'generated': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'counts': {'site_pages': len(stations), 'open_on_site': sum(not s['closed_on_site'] for s in stations),
                   'muster_k1_bookable': len(muster), 'reminder_names': len(reminders),
                   'reminder_only': len(extra)},
        'stations': stations,
        'reminder_only_stations': extra,
    }
    with open(out, 'w', encoding='utf8') as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
