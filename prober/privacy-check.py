"""Read directory entry names only; never print identifiers or read pebble content."""
from pathlib import Path
import os
import re
import subprocess

root = Path(__file__).resolve().parent.parent
# PEBBLE_DIRS: extra pebble directories (os.pathsep-separated), e.g. a moved data disk.
home = Path(os.environ.get('BEDROCK_HOME', Path.home() / '.bedrock'))
sources = [home / 'pebbles', *(Path(d) for d in os.environ.get('PEBBLE_DIRS', '').split(os.pathsep) if d)]
names = set()
missing = 0
for source in sources:
    if source.is_dir():
        names.update(entry.name for entry in source.iterdir())
    else:
        missing += 1
assert names, 'No real pebble identifiers available for the required check'
artifacts = root / 'prober/artifacts/e2e'
files = [p for base in [root / 'public/dist', root / 'status', artifacts] for p in base.rglob('*')
         if p.is_file() and (p.suffix in {'.json', '.jsonl', '.html', '.css', '.js', '.log'})]
assert files
# Run an actual fixed-string search too; suppress all matching content and identifiers.
command = ['rg', '-l', '-F']
for name in sorted(names):
    command.extend(['-e', name])
scan = subprocess.run(command + ['--'] + [str(p) for p in files], capture_output=True, text=True)
assert scan.returncode in (0, 1), 'Fixed-string grep could not run'
assert scan.returncode == 1, 'Fixed-string grep found a private identifier (content suppressed)'
matches = []
for path in files:
    body = path.read_text()
    for name in names:
        # Fixed-string grep semantics, no token-boundary exceptions.
        if name in body:
            matches.append(path.relative_to(root).as_posix())
    if re.search(r'https?://(?!github\.com/TwiN/gatus)[^\s"<>]+', body):
        matches.append(path.relative_to(root).as_posix())
assert not matches, f'Privacy check failed in {len(set(matches))} artifacts; inspect locally, do not log identifiers'
print(f'Privacy passed: {len(names)} identifiers, {len(files)} files, 0 fixed-string/name or target URL matches; {missing}/{len(sources)} source directories absent.')
