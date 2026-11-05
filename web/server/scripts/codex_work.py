"""Local Codex work projection. Never writes the personal ledger or source files.
SQLite is a rebuildable event index; corrections.json is the durable user-owned layer.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

TZ = dt.timezone(dt.timedelta(hours=8))
FIRST_DAY = os.environ.get('TIME_LEDGER_CODEX_FIRST_DAY', '2020-01-01')
MAX_LINE = 8 * 1024 * 1024
EXCLUDED = set()


def epoch(value):
    try:
        n = value * 1000 if isinstance(value, (float, int)) else dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
        return n if 946684800000 <= n < 4102444800000 else None
    except (ValueError, TypeError, AttributeError):
        return None


def midnight(day):
    return dt.datetime.fromisoformat(day + 'T00:00:00+08:00').timestamp() * 1000


def day_of(ms):
    return dt.datetime.fromtimestamp(ms / 1000, TZ).date().isoformat()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def clean(text):
    if not isinstance(text, str):
        return ''
    text = re.sub(r'<oai-mem-citation>[\s\S]*?</oai-mem-citation>', '', text)
    text = re.sub(r'<environment_context>[\s\S]*?</environment_context>', '', text)
    text = re.sub(r'<in-app-browser-context[\s\S]*?</in-app-browser-context>', '', text)
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    text = re.sub(r':{1,2}codex-[^\n]*', '', text)
    text = re.sub(r'::(?:inbox-item|archive-thread)\{[^\n]*\}', '', text)
    heartbeat = re.search(r'<heartbeat>[\s\S]*?<message>([\s\S]*?)</message>[\s\S]*?</heartbeat>', text)
    if heartbeat:
        text = heartbeat.group(1)
    text = re.sub(r'```[\s\S]*?```', '', text)
    return text.replace('**', '').replace('`', '').strip()


def request_text(text):
    if not isinstance(text, str) or text.lstrip().startswith(('# AGENTS.md instructions', '<skill>', '<environment_context>', '<external_codex_apps_open_page>')):
        return ''
    if text.lstrip().startswith('<send_user_message_question_reply>'):
        try:
            values = json.loads(text.split('>', 1)[1].split('</send_user_message_question_reply>')[0])
            return '；'.join(str(v.get('answer', '')) for v in values if isinstance(v, dict))[:1800]
        except (ValueError, TypeError):
            return ''
    comments = re.findall(r'Comment:\s*([^\n]+)', text)
    if comments:
        return '；'.join(comments)[:1800]
    if '## My request:' in text:
        text = text.rsplit('## My request:', 1)[-1]
    if text.lstrip().startswith('The next image is untrusted'):
        return ''
    return clean(text)[:1800]


def excerpt(text, limit=700):
    text = clean(text)
    lines = [re.sub(r'^\s*[#>*\-]+\s*', '', x).strip() for x in text.splitlines()]
    return '\n'.join(x for x in lines if x)[:limit]


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.root / 'index.sqlite', timeout=10)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, data TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        self.db.commit()
        os.chmod(self.root / 'index.sqlite', 0o600)

    def get(self, table, key, default=None):
        field = 'path' if table == 'files' else 'id'
        row = self.db.execute(f'SELECT data FROM {table} WHERE {field}=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, table, key, value):
        self.db.execute(f'INSERT OR REPLACE INTO {table} VALUES (?,?)', (key, json.dumps(value, ensure_ascii=False)))

    def corrections(self):
        p = self.root / 'corrections.json'
        if not p.exists():
            # A missing canonical file with prior backups is a recovery condition, not empty data.
            if list((self.root / 'backups').glob('*.json')):
                raise ValueError('更正文件缺失，请从独立备份恢复。')
            return {'schema': 1, 'revision': 0, 'overrides': {}, 'reviewed': {}}
        x = json.loads(p.read_text())
        if x.get('schema') != 1 or not isinstance(x.get('revision'), int) or not isinstance(x.get('overrides'), dict) or not isinstance(x.get('reviewed'), dict):
            raise ValueError('更正文件无效，请从独立备份恢复。')
        return x

    def write_corrections(self, value):
        # Caller holds the process lock. Both copies are fsynced before reporting success.
        backup = self.root / 'backups'
        backup.mkdir(exist_ok=True, mode=0o700)
        raw = json.dumps(value, ensure_ascii=False, indent=2).encode()
        self.atomic(backup / (str(value['revision']) + '-' + str(time.time_ns()) + '.json'), raw)
        self.atomic(self.root / 'corrections.json', raw)

    @staticmethod
    def atomic(path, raw):
        tmp = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
        fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def ingest_event(store, event, state, locator, line):
    p = event.get('payload') or {}
    if not isinstance(p, dict):
        return
    t = epoch(event.get('timestamp'))
    if event.get('type') == 'session_meta':
        state['thread'] = str(p.get('id', ''))
        return
    if t is None:
        return
    typ = p.get('type')
    tid = p.get('turn_id') or state.get('active')
    if event.get('type') == 'event_msg' and typ == 'task_started' and tid:
        state['active'] = tid
    if not tid or not isinstance(tid, str) or len(tid) > 100:
        return
    # Capture starts crossing the first day, while avoiding prehistory persistence.
    if t < midnight(FIRST_DAY) - 86400000:
        return
    r = store.get('runs', tid, {'id': tid, 'threadId': state.get('thread', ''), 'status': 'open', 'sources': [], 'request': '', 'receipt': ''})
    changed = False
    def receipt(value):
        r['artifactPaths'] = re.findall(r'/Users/[^\s`<>\n\)]+\.(?:md|html|pdf|docx|png|json)', value)[:12]
        r['receipt'] = clean(value)[:12000]
    def user_text(value):
        return request_text(value)
    if event.get('type') == 'event_msg':
        if typ == 'task_started':
            # Duplicate starts must not erase an already observed end.
            observed_start = epoch(p.get('started_at')) or t
            if r.get('startEvent') is not None and r['startEvent'] != observed_start:
                r['conflict'] = True
            r.setdefault('startEvent', observed_start)
            if r.get('end') is None:
                r.setdefault('start', observed_start)
            r['parent'] = p.get('root_turn_id') if p.get('root_turn_id') != tid else None
            changed = True
        elif typ in ('task_complete', 'turn_aborted', 'task_failed', 'task_cancelled'):
            start = epoch(p.get('started_at'))
            end = epoch(p.get('completed_at')) or t
            if r.get('end') is not None and (r['end'] != end or start is not None and r.get('start') != start):
                r['conflict'] = True
            else:
                if start is not None:
                    r['start'] = start
                r['end'] = end
                r['status'] = {'task_complete': 'completed', 'task_failed': 'failed'}.get(typ, 'cancelled')
                if isinstance(p.get('duration_ms'), (int, float)) and p['duration_ms'] >= 0:
                    r['sourceDurationMs'] = p['duration_ms']
                if p.get('root_turn_id') and p['root_turn_id'] != tid:
                    r['parent'] = p['root_turn_id']
                if p.get('last_agent_message'):
                    receipt(p['last_agent_message'])
            if state.get('active') == tid:
                state['active'] = None
            changed = True
        elif typ == 'user_message':
            text = user_text(p.get('message'))
            if text:
                r['request'] = text
                changed = True
    elif event.get('type') == 'response_item' and typ == 'message':
        text = '\n'.join(c.get('text', '') for c in p.get('content', []) if isinstance(c, dict) and isinstance(c.get('text'), str))
        if p.get('role') == 'user':
            text = user_text(text)
            if text:
                r['request'] = text
                changed = True
        elif p.get('role') == 'assistant' and p.get('channel') == 'final':
            receipt(text)
            changed = True
    if changed:
        if typ in ('task_started', 'task_complete', 'turn_aborted', 'task_failed', 'task_cancelled'):
            src = locator + ':' + str(line)
            if src not in r['sources']:
                r['sources'].append(src)
                r['sources'] = r['sources'][-12:]
        r['lastObserved'] = max(r.get('lastObserved', 0), t)
        store.put('runs', tid, r)


def scan(store, roots, budget=128 * 1024 * 1024, seconds=8):
    deadline = time.monotonic() + seconds
    files = []
    errors = []
    for root in roots:
        root = Path(root).resolve()
        if not root.exists():
            errors.append('来源目录不可用：' + root.name)
            continue
        for folder, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
            for name in names:
                if not name.startswith('rollout-') or not name.endswith('.jsonl'):
                    continue
                p = Path(folder) / name
                try:
                    if p.is_symlink() or p.stat().st_mtime * 1000 < midnight(FIRST_DAY):
                        continue
                    files.append((p, root.name + '/' + str(p.relative_to(root))))
                except OSError:
                    errors.append('有来源无法访问')
    consumed = 0
    pending = 0
    partial = 0
    for path, locator in sorted(files, key=lambda f: f[1]):
        try:
            stat = path.stat()
            state = store.get('files', locator, {'offset': 0, 'line': 0, 'active': None})
            with path.open('rb') as f:
                prefix = digest(f.read(min(4096, state.get('prefixLength', 4096))))
                identity = f'{stat.st_dev}:{stat.st_ino}'
                if state.get('parserVersion') != 2 or state.get('identity') != identity or stat.st_size < state['offset'] or state.get('prefixHash', prefix) != prefix or (stat.st_size == state['offset'] and state.get('mtime', stat.st_mtime) != stat.st_mtime):
                    state = {'offset': 0, 'line': 0, 'active': None}
                length = min(4096, stat.st_size)
                f.seek(0)
                state.update(parserVersion=2, identity=identity, size=stat.st_size, prefixLength=length, prefixHash=digest(f.read(length)), mtime=stat.st_mtime)
                f.seek(state['offset'])
                initial = state['offset']
                while consumed < budget and state['offset'] - initial < 64 * 1024 * 1024 and time.monotonic() < deadline:
                    offset = f.tell()
                    raw = f.readline(MAX_LINE + 1)
                    if not raw:
                        break
                    consumed += len(raw)
                    if state.get('skipping'):
                        state['offset'] = f.tell()
                        if raw.endswith(b'\n'):
                            state['skipping'] = False
                            state['line'] += 1
                            state['oversize'] = state.get('oversize', 0) + int(state.pop('skipRelevant', False))
                        continue
                    if not raw.endswith(b'\n'):
                        if len(raw) <= MAX_LINE:
                            state['tail'] = True
                            break
                        state['skipping'] = True
                        state['skipRelevant'] = bool(b'"event_msg"' in raw[:350] or (b'"response_item"' in raw[:350] and re.search(rb'"type"\s*:\s*"message"', raw[:500])))
                        state['offset'] = f.tell()
                        continue
                    state['offset'] = f.tell(); state['line'] += 1; state['tail'] = False
                    prefix = raw[:350]
                    if not any(s in prefix for s in (b'"event_msg"', b'"session_meta"', b'"response_item"')):
                        continue
                    if b'"response_item"' in prefix and not re.search(rb'"type"\s*:\s*"message"', raw[:500]):
                        continue
                    try:
                        ingest_event(store, json.loads(raw), state, locator, state['line'])
                    except (ValueError, TypeError, KeyError):
                        state['malformed'] = state.get('malformed', 0) + 1
                state['error'] = None
                # A partial tail remains pending but does not cause rapid infinite refresh.
                remaining = state['offset'] < stat.st_size
                if remaining and state.get('tail'):
                    partial += 1
                elif remaining:
                    pending += 1
                store.put('files', locator, state)
                store.db.commit()
        except OSError:
            errors.append('来源读取失败：' + path.name)
    states = [json.loads(row[0]) for row in store.db.execute('SELECT data FROM files')]
    meta = {'updatedAt': dt.datetime.now(TZ).isoformat(), 'firstDay': FIRST_DAY, 'files': len(files), 'pendingFiles': pending, 'partialFiles': partial, 'bytesRead': consumed,
            'warnings': sorted(set(errors)), 'malformedLines': sum(s.get('malformed', 0) for s in states), 'oversizeLines': sum(s.get('oversize', 0) for s in states)}
    store.put('meta', 'scan', meta); store.db.commit()
    # Preserve a daily event-index snapshot as well as every correction version.
    last_snapshot = store.get('meta', 'lastSnapshot', 0)
    if not pending and consumed and time.time() - last_snapshot > 600:
        backup = store.root / 'backups'
        backup.mkdir(exist_ok=True, mode=0o700)
        target = backup / ('index-' + dt.datetime.now(TZ).date().isoformat() + '.sqlite')
        temporary = target.with_suffix('.sqlite.tmp')
        with sqlite3.connect(temporary) as dest:
            store.db.backup(dest)
        fd = os.open(temporary, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, target)
        store.put('meta', 'lastSnapshot', time.time()); store.db.commit()
    return meta


def read_memory(root, start, end):
    found = {}
    day = dt.date.fromisoformat(max(start, FIRST_DAY))
    stop = dt.date.fromisoformat(end)
    while day < stop:
        p = Path(root) / (day.isoformat() + '.md')
        day += dt.timedelta(days=1)
        if p.is_symlink() or not p.exists() or p.stat().st_size > 4 * 1024 * 1024:
            continue
        text = p.read_text()
        for block in re.split(r'(?=^### )', text, flags=re.M):
            m = re.search(r'更新ID[：:]\s*([a-zA-Z0-9_-]{1,100})', block)
            if m:
                summary = re.search(r'一句话结论[：:]\s*([^\n]+)', block)
                found[m[1]] = {'text': summary.group(1) if summary else excerpt(block, 700), 'source': 'memory/' + p.name + '#' + m[1]}
    return found


# Conservative, content-bound rules. A chat title is never a project identity.
RULES = []
# Optional local JSON: {"rules": [["Project", "pattern"]], "destinations": [["Project", "path-pattern"]]}
CONFIG = {}
if os.environ.get('TIME_LEDGER_CODEX_RULES_FILE'):
    CONFIG = json.loads(Path(os.environ['TIME_LEDGER_CODEX_RULES_FILE']).read_text())
    RULES = CONFIG.get('rules', [])


def unique_match(text, rules=RULES):
    matches = {name for name, pattern in rules if re.search(pattern, text, re.I)}
    return next(iter(matches)) if len(matches) == 1 else None


def task_identity(r):
    """Identify the work being done, before considering subjects mentioned in it.

    No chat-wide inheritance: a later turn can change from research to video or
    from product work to app troubleshooting. Ambiguous cases remain reviewable.
    """
    req = request_text(r.get('request', ''))
    receipt = excerpt(r.get('receipt', ''), 12000)
    automation = re.match(r'Automation:\s*([^\n]+)', req)
    heartbeat = re.search(r'<instructions>\s*([^。\n]+)', req)
    if automation or heartbeat:
        task = (automation or heartbeat).group(1)
        group = unique_match(task)
        if group:
            return group, task.strip()[:70], '自动归组 · 任务说明'
    first = receipt.split('\n')[0] if receipt else ''
    destinations = CONFIG.get('destinations', [])
    paths = '\n'.join(r.get('artifactPaths', []))
    group = unique_match(paths, destinations)
    if group:
        return group, None, '自动归组 · 产物归属'
    # An explicit user task is more relevant than examples or exclusions in the receipt.
    group = unique_match(req)
    if group:
        return group, None, '自动归组 · 当前需求'
    if r.get('contextProject') and not unique_match(first):
        return r['contextProject'], None, '自动归组 · 当前页面'
    group = unique_match(first)
    if group:
        return group, None, '自动归组 · 结果说明'
    group = unique_match(req + '\n' + receipt)
    return group or '待归属', None, '自动摘录'


def describe(r, memory, reviewed):
    if r['id'] in reviewed:
        saved = reviewed[r['id']]
        if saved.get('sourceFingerprint') and saved['sourceFingerprint'] != review_fingerprint(r):
            # A previously open run can finish. Keep the checked identity, but do
            # not freeze "no end receipt" forever. Explicit user overrides still win.
            fresh = describe(r, memory, {})
            return {**fresh, 'group': saved['group'], 'title': saved['title'], 'basis': '归属已核对 · 回执已更新'}
        return dict(saved, basis='归属已核对')
    receipt = r.get('receipt', '')
    req = request_text(r.get('request', ''))
    mem = memory.get(r['id'])
    group, task_title, basis = task_identity(r)
    summary = excerpt(receipt or (mem or {}).get('text', ''), 700)
    lines = [s.strip() for s in excerpt(req, 300).splitlines() if s.strip()]
    title = (lines[0] if lines else excerpt(summary, 60).split('\n')[0])[:70] or '结果待补充'
    if title in ('可以', '好的', '好', '👌', '继续') or title.startswith(('Response annotations', '# Response annotations')):
        title = excerpt(summary, 70).split('\n')[0] or '执行结果待补充'
    title = task_title or title
    routine = bool(re.search(r'HEARTBEAT_OK|DONT_NOTIFY|没有新增.*任务|无新增.*任务|无新增.*静默|无需.*提醒|无需处理', receipt))
    artifacts = []
    # Retain destinations as copyable local provenance; never render arbitrary raw HTML/URLs.
    for match in re.finditer(r'(/Users/[^\s`<>\n]+\.(?:md|html|pdf|docx|png|json))', receipt + '\n' + '\n'.join(r.get('artifactPaths', []))):
        location = match.group(1).rstrip('。；，)）')
        if not any(a['path'] == location for a in artifacts):
            artifacts.append({'label': Path(location).name, 'path': location})
    return {'group': group, 'title': title, 'summary': summary or '暂无结果回执；执行状态与任务成果分开核对。', 'state': '回执摘录' if summary else '结果待核', 'basis': basis, 'routine': routine, 'artifacts': artifacts[:6]}


def review_fingerprint(run):
    # Source evidence can grow while an offline review is in progress.
    value = {k: run.get(k) for k in ('request', 'receipt', 'artifactPaths', 'start', 'end', 'status')}
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True).encode())


def apply_review(store, body):
    """Atomic local review import; does not alter events or user overrides."""
    current = store.corrections()
    if body.get('revision') != current['revision']:
        raise ValueError('CONFLICT: 复核期间更正已变化，请重新核对。')
    rows = body.get('entries')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 500:
        raise ValueError('复核批次无效。')
    additions = {}
    for row in rows:
        key = row.get('id')
        run = store.get('runs', key) if isinstance(key, str) else None
        if not run or row.get('fingerprint') != review_fingerprint(run):
            raise ValueError('CONFLICT: 复核来源已变化或不存在，请重新读取。')
        if key in current['reviewed'] or key in additions:
            raise ValueError('已有核对内容或执行重复，不覆盖。')
        value = row.get('review')
        validate_backup({'overrides': {}, 'reviewed': {key: value}})
        if value['group'] in EXCLUDED:
            raise ValueError('该泛化项目已排除。')
        additions[key] = {**value, 'sourceFingerprint': row['fingerprint']}
    current['reviewed'].update(additions)
    current['revision'] += 1
    store.write_corrections(current)
    return current


def report(store, start, end, memory_root):
    corrections = store.corrections()
    memory = read_memory(memory_root, start, end)
    all_runs = {key: json.loads(value) for key, value in store.db.execute('SELECT id,data FROM runs')}
    lower, upper = max(midnight(start), midnight(FIRST_DAY)), midnight(end)
    entries = []
    for r in all_runs.values():
        a, b = r.get('start'), r.get('end')
        at = a or b or r.get('lastObserved')
        if not at or (b is not None and b <= lower) or at >= upper or b is None and at < lower:
            continue
        d = describe(r, memory, corrections['reviewed'])
        d.update(corrections['overrides'].get(r['id'], {}))
        if d.get('group') in EXCLUDED:
            d['group'] = '待归属'
        ms = None
        bucket = 'unknown'
        parent = all_runs.get(r.get('parent'), {})
        parent_known = parent.get('start') is not None and parent.get('end') is not None and not parent.get('conflict')
        parent_contains = parent_known and a is not None and b is not None and parent['start'] <= a <= b <= parent['end']
        if parent_contains:
            bucket = 'nested'
        elif parent_known and a is not None and b is not None:
            bucket = 'unknown'
        elif a is not None and b is not None and b >= a and not r.get('conflict'):
            ms = max(0, min(b, upper) - max(a, lower)); bucket = 'known'
        elif b is None:
            bucket = 'open'
        # A user correction applies only when it has an explicit observed interval.
        entries.append({**d, 'id': r['id'], 'threadId': r.get('threadId'), 'start': a, 'end': b, 'status': r['status'], 'bucket': bucket, 'ms': ms,
                        'sourceDurationMs': r.get('sourceDurationMs'), 'sources': r['sources'] + ([memory[r['id']]['source']] if r['id'] in memory else []),
                        'receipt': excerpt(r.get('receipt', ''), 3000), 'sourceConflict': bool(r.get('conflict')), 'orphanChild': bool(r.get('parent') and not parent_contains),
                        'hidden': bool(d.get('hidden')), 'corrected': r['id'] in corrections['overrides']})
    entries.sort(key=lambda r: r.get('start') or r.get('end') or 0)
    groups = {}
    for r in entries:
        name = r['group'] or '待归属'
        g = groups.setdefault(name, {'name': name, 'ms': 0, 'count': 0, 'matters': {}, 'days': {}})
        g['count'] += 1; g['ms'] += r['ms'] or 0
        key = r['title']
        m = g['matters'].setdefault(key, {'title': key, 'summary': r['summary'], 'state': r['state'], 'basis': r['basis'], 'ms': 0, 'runs': [], 'routine': True, 'hidden': True, 'artifacts': []})
        m['ms'] += r['ms'] or 0; m['runs'].append(r['id']); m['routine'] &= bool(r.get('routine')); m['hidden'] &= r['hidden']
        m['summary'] = r['summary']; m['state'] = r['state']
        for artifact in r.get('artifacts', []):
            if artifact not in m['artifacts']:
                m['artifacts'].append(artifact)
        if r['ms'] is not None:
            cursor = max(lower, r['start']); stop = min(upper, r['end'])
            while cursor < stop:
                day = day_of(cursor); next_day = midnight((dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat())
                amount = min(stop, next_day) - cursor
                g['days'][day] = g['days'].get(day, 0) + amount
                cursor += amount
    group_list = [{**g, 'matters': sorted(g['matters'].values(), key=lambda m: -m['ms'])} for g in groups.values()]
    group_list.sort(key=lambda g: -g['ms'])
    return {'schema': 1, 'range': {'start': start, 'end': end}, 'revision': corrections['revision'], 'runs': entries, 'groups': group_list,
            'memoryNotes': [v for k, v in corrections['reviewed'].items() if k.startswith('memory_') and start <= v.get('sourceDate', '') < end],
            'metrics': {'ms': sum(r['ms'] or 0 for r in entries), 'closed': sum(r['end'] is not None for r in entries), 'open': sum(r['bucket'] == 'open' for r in entries), 'unknown': sum(r['bucket'] == 'unknown' for r in entries), 'nested': sum(r['bucket'] == 'nested' for r in entries)},
            'scan': store.get('meta', 'scan', {'firstDay': FIRST_DAY, 'files': 0, 'pendingFiles': 0, 'partialFiles': 0, 'warnings': [], 'updatedAt': None})}


def patch(store, body):
    c = store.corrections()
    if body.get('revision') != c['revision']:
        raise ValueError('CONFLICT: 更正在其他页面更新，请刷新后重试。')
    ids = body.get('ids')
    fields = body.get('fields')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i, str) or not store.get('runs', i) for i in ids):
        raise ValueError('无效的执行选择。')
    if not isinstance(fields, dict) or set(fields) - {'title', 'group', 'summary', 'hidden'}:
        raise ValueError('无效的更正字段。')
    for k, v in fields.items():
        if k == 'hidden':
            if not isinstance(v, bool):
                raise ValueError('隐藏值无效。')
        elif not isinstance(v, str) or not v.strip() or len(v) > (2000 if k == 'summary' else 100):
            raise ValueError('请检查文字长度。')
        if k == 'group' and v.strip() in EXCLUDED:
            raise ValueError('该泛化项目已排除，请使用具体事项名称。')
    for i in ids:
        c['overrides'][i] = {**c['overrides'].get(i, {}), **{k: v.strip() if isinstance(v, str) else v for k, v in fields.items()}}
    c['revision'] += 1
    store.write_corrections(c)
    return c


def seed(store, file):
    x = json.loads(Path(file).read_text())
    c = store.corrections()
    for g in x['groups']:
        for m in g['matters']:
            for i in m['runIds']:
                c['reviewed'].setdefault(i, {'group': g['name'], 'title': m['title'], 'summary': m['summary'], 'state': m['status'], 'routine': m['routine'], 'artifacts': m['artifacts']})
    for m in x.get('memoryOnlyMatters', []):
        c['reviewed'].setdefault('memory_' + m['id'], {'group': '来源待核', 'title': m['title'], 'summary': m['summary'], 'state': '未匹配执行', 'routine': False, 'artifacts': [], 'sourceDate': x['date']})
    c['revision'] += 1
    store.write_corrections(c)


def validate_backup(source):
    allowed_review = {'group', 'title', 'summary', 'state', 'routine', 'artifacts', 'sourceDate', 'sourceFingerprint'}
    for kind in ('overrides', 'reviewed'):
        rows = source[kind]
        if len(rows) > 20000:
            raise ValueError('备份条目过多。')
        for key, row in rows.items():
            allowed = {'group', 'title', 'summary', 'hidden'} if kind == 'overrides' else allowed_review
            if not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', key) or not isinstance(row, dict) or set(row) - allowed:
                raise ValueError('备份字段无效。')
            for name, value in row.items():
                if name == 'sourceFingerprint':
                    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
                        raise ValueError('复核来源指纹无效。')
                elif name in ('hidden', 'routine'):
                    if not isinstance(value, bool):
                        raise ValueError('备份开关无效。')
                elif name == 'artifacts':
                    if not isinstance(value, list) or len(value) > 30 or any(not isinstance(a, dict) or not isinstance(a.get('path'), str) or len(a['path']) > 2000 or not isinstance(a.get('label'), str) or len(a['label']) > 500 for a in value):
                        raise ValueError('备份产物字段无效。')
                elif not isinstance(value, str) or len(value) > (4000 if name == 'summary' else 100):
                    raise ValueError('备份文字字段无效。')
            if kind == 'reviewed' and not {'group', 'title', 'summary', 'state', 'routine', 'artifacts'}.issubset(row):
                raise ValueError('备份核对结果不完整。')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['read', 'refresh', 'patch', 'backup', 'restore', 'seed', 'review'])
    ap.add_argument('--store', required=True); ap.add_argument('--sessions', required=True); ap.add_argument('--archived'); ap.add_argument('--memory', required=True)
    ap.add_argument('--start', required=True); ap.add_argument('--end', required=True); ap.add_argument('--seed')
    args = ap.parse_args()
    a, b = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    if not 0 < (b-a).days <= 32:
        raise ValueError('最多读取一个月的日期范围。')
    os.umask(0o077)
    s = Store(args.store)
    with (s.root / 'writer.lock').open('a') as lock:
        if args.command != 'read':
            fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'refresh':
            scan(s, [args.sessions] + ([args.archived] if args.archived else []))
        elif args.command == 'patch':
            patch(s, json.loads(sys.stdin.read(65537)))
        elif args.command == 'seed':
            seed(s, args.seed)
        elif args.command == 'review':
            apply_review(s, json.loads(sys.stdin.read(2 * 1024 * 1024 + 1)))
        elif args.command == 'backup':
            print(json.dumps(s.corrections(), ensure_ascii=False)); return
        elif args.command == 'restore':
            body = json.loads(sys.stdin.read(2 * 1024 * 1024 + 1))
            c = s.corrections()
            if body.get('revision') != c['revision']:
                raise ValueError('CONFLICT: 请刷新后再恢复。')
            source = body.get('backup', {})
            if source.get('schema') != 1 or not isinstance(source.get('overrides'), dict) or not isinstance(source.get('reviewed'), dict):
                raise ValueError('备份格式无效。')
            # Imported backup is untrusted JSON, never an executable receipt or a time source.
            validate_backup(source)
            restored = {'schema': 1, 'revision': c['revision'] + 1, 'overrides': source['overrides'], 'reviewed': source['reviewed']}
            s.write_corrections(restored)
        print(json.dumps(report(s, args.start, args.end, args.memory), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # No raw transcript, stack or credentials in the HTTP error surface.
        print(json.dumps({'error': str(exc) if isinstance(exc, ValueError) else '本机索引暂时不可用，请重试或检查备份。'}, ensure_ascii=False))
        sys.exit(1)
