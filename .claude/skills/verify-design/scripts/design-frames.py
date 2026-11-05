import html.parser
import json
import os
import re
import subprocess
import sys
import urllib.parse

class Images(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []
        self.links = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        src = attrs.get('src', '')
        href = attrs.get('href', '')
        if tag == 'img' and src.startswith('https://files.hypertask.app/'):
            self.images.append((src, attrs.get('alt', '')))
        if tag == 'a' and re.match(r'https://(?:www\.)?figma\.com/design/', href):
            self.links.append(href)

tasks, comments, out = sys.argv[1:]
with open(tasks) as f:
    description = json.load(f)['tasks'][0].get('description') or ''
with open(comments) as f:
    comments = json.load(f)['comments']
os.makedirs(os.path.join(out, 'frames'), exist_ok=True)
rows, links, used = [], [], {}
for source, text in [('description', description)] + [(f"comment-{c['id']}", c.get('text') or '') for c in comments]:
    parser = Images()
    parser.feed(text)
    links.extend(parser.links)
    for url, alt in parser.images:
        basename = urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit('/', 1)[-1])
        match = re.search(r'.*_[0-9a-f]{16}_([^/]+?\.png)(?:_|$)', basename, re.I)
        name = os.path.basename(alt) if alt.lower().endswith('.png') else (match.group(1) if match else '')
        if not name:
            match = re.search(r'(?:^|_)([^_/]+\.png)(?:_|$)', basename, re.I)
            name = match.group(1) if match else ''
        if not name:
            raise SystemExit(f'Cannot determine image name: {url}')
        if name in used:
            if used[name] == url:
                continue
            stem, ext = os.path.splitext(name)
            name = f'{stem}-{source}{ext}'
            if name in used:
                raise SystemExit(f'Conflicting frame name {name}; rename one source image')
        used[name] = url
        path = os.path.join(out, 'frames', name)
        subprocess.run(['curl', '-fsSL', '--max-time', '60', '-o', path, url], check=True)
        size = subprocess.check_output(['identify', '-format', '%wx%h', path], text=True)
        rows.append(f'{name}\t{size}\t{source}')
with open(os.path.join(out, 'frames.tsv'), 'w') as f:
    f.write('name\tsize\tsource\n' + ''.join(row + '\n' for row in rows))
with open(os.path.join(out, 'figma-links.txt'), 'w') as f:
    f.write(''.join(link + '\n' for link in dict.fromkeys(links)))
print('\n'.join(rows))
