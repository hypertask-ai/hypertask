DOMAINS = frozenset({'Commands', 'Flags', 'Search', 'Prompts', 'Parity', 'Shipping'})
SHARED = 'Shared'
UNSCOPED = 'Unscoped'
LEASE_DOMAINS = DOMAINS | {SHARED, UNSCOPED}


def label_domain(labels):
    names = {label.get('name', label.get('value')) for label in labels if isinstance(label, dict)}
    found = {name.removeprefix('Domain: ') for name in names
             if isinstance(name, str) and name.startswith('Domain: ')} & DOMAINS
    if not found:
        return UNSCOPED
    return next(iter(found)) if len(found) == 1 else SHARED


def conflicts(first, second):
    return UNSCOPED not in (first, second) and (first == second or SHARED in (first, second))
