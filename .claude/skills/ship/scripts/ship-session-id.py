#!/usr/bin/env python3
import os
from pathlib import Path
import uuid


def session_id():
    for key in ('CLAUDE_CODE_SESSION_ID', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID',
                'CURSOR_CONVERSATION_ID', 'PI_SESSION_ID'):
        if value := os.environ.get(key):
            return value

    try:
        boot = uuid.UUID(Path('/proc/sys/kernel/random/boot_id').read_text().strip())
        pid = os.getppid()
        seen = set()
        while pid > 1 and pid not in seen:
            seen.add(pid)
            proc = Path('/proc') / str(pid)
            fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
            parent, started = int(fields[1]), fields[19]
            if (proc / 'exe').resolve(strict=True).name == 'hax' and proc.stat().st_uid == os.getuid():
                return str(uuid.uuid5(boot, f'hax:{pid}:{started}'))
            pid = parent
    except (OSError, ValueError, IndexError):
        pass
    return ''


if __name__ == '__main__':
    print(session_id(), end='')
