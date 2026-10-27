import re
import sys
from html.parser import HTMLParser


class CommentText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines = []
        self.line = ""
        self.prefix = ""
        self.bold_start = None
        self.bold_end = None
        self.link = 0
        self.code = 0
        self.mention = 0
        self.code_names = False

    def boundary(self):
        if self.line.strip():
            self.lines.append(self.line.strip())
        self.line = ""
        self.prefix += "\n"

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"p", "li", "h2", "br", "pre"}:
            self.boundary()
        if tag in {"strong", "b"} and self.bold_start is None:
            self.bold_start = self.prefix.strip()
        if tag == "a" and re.match(r"https://", attrs.get("href", "")):
            self.link += 1
        if tag == "code":
            self.code += 1
        if tag == "span" and (attrs.get("data-type") == "mention" or self.mention):
            self.mention += 1

    def handle_endtag(self, tag):
        if tag in {"strong", "b"} and self.bold_start is not None and self.bold_end is None:
            self.bold_end = self.prefix.strip()
        if tag in {"p", "li", "h2", "pre"}:
            self.boundary()
        if tag == "a":
            self.link = max(0, self.link - 1)
        if tag == "code":
            self.code = max(0, self.code - 1)
        if tag == "span":
            self.mention = max(0, self.mention - 1)

    def handle_data(self, data):
        if self.mention:
            return
        self.prefix += data
        if self.code and data.strip() and not re.fullmatch(r"\s*(?:htpr|yper4)-\d+-[a-z0-9-]+\s*", data):
            self.code_names = True
        self.line += " link " if self.link else data


def findings(text, markdown=False):
    if markdown:
        text = re.sub(r"\[([^\]]+)\]\(https://[^\s)]+\)", "<a href='https://link'>link</a>", text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    parsed = CommentText()
    parsed.feed(text)
    parsed.boundary()
    issues = []
    if (parsed.bold_start not in {"", "Question:"} or not parsed.bold_end
            or (not re.search(r"[.!?]$", parsed.bold_end)
                and parsed.bold_end != (parsed.lines[0] if parsed.lines else ""))):
        issues.append("make the first sentence bold")
    if parsed.code_names:
        issues.append("replace code names with plain words")
    for line in parsed.lines:
        if re.match(r"^(?:Next|Helpers|Branch/PR|Outputs):", line):
            continue
        line = re.sub(r"https://\S+", "link", line)
        line = re.sub(r"Question:\s*Switch\s+[a-z0-9-]+\s+to\s+(?:Only me|Owner \+ QA|Everyone|Off)\?", "Question: Switch it?", line)
        if "—" in line:
            issues.append("replace the em dash")
        if re.search(r"`[^`]+`", line):
            issues.append("replace code names with plain words")
        if re.search(r"(?<!\S)~?/[\w./-]+|\b(?:runner\d*|feature|fix|bugfix|infra|chore|ceo)/[\w./-]+|\b[\w./-]+\.(?:tsx?|jsx?|py|sh|md|json)\b", line):
            issues.append("replace file paths and branch names")
        if re.search(r"\bPR\s*#?\d+\b|(?<!\w)#\d+\b", line, re.I):
            issues.append("use a linked PR reference")
        line = re.sub(r"\s+", " ", line)
        for sentence in re.split(r"(?<=[.!?])\s+", line):
            if len(re.findall(r"\b[\w’'-]+\b", sentence)) > 25:
                issues.append("shorten sentences to 25 words")
            if re.match(r"\s*(?:I'll\b|I’ll\b|Let me\b|Great\b|Sure\b|I hope this helps\b)", sentence, re.I):
                issues.append("remove filler openers")
    return list(dict.fromkeys(issues))


if __name__ == "__main__":
    issues = findings(sys.stdin.read(), sys.argv[1:] == ["true"])
    if issues:
        print("vcc: Comment refused: " + "; ".join(issues) + "; rewrite it for a product owner (pospeak)", file=sys.stderr)
        sys.exit(5)
