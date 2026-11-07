"""Schema-ish validation; needs PyYAML. --remote also resolves each pinned SHA with `gh api`."""
from pathlib import Path
import re
import subprocess
import sys
import yaml

root = Path(__file__).resolve().parent.parent
path = root / '.github/workflows/bedrock-probe.yml'
workflow = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
assert list((root / '.github/workflows').glob('*')) == [path]
assert set(workflow['on']) == {'schedule', 'workflow_dispatch'}
assert workflow['on']['schedule'] == [{'cron': '2-57/5 * * * *'}]
assert workflow['concurrency'] == {'group': 'bedrock-public-journal', 'cancel-in-progress': 'false'}
assert workflow['permissions'] == {}
assert set(workflow['jobs']) == {'probe', 'deploy'}
assert workflow['jobs']['probe']['permissions'] == {'contents': 'write', 'issues': 'write', 'actions': 'read'}
assert workflow['jobs']['deploy']['permissions'] == {'pages': 'write', 'id-token': 'write'}
assert workflow['jobs']['deploy']['needs'] == 'probe'
assert '!cancelled()' in workflow['jobs']['deploy']['if']
assert "page_ready == 'true'" in workflow['jobs']['deploy']['if']
uses = []
pins = []
for job in workflow['jobs'].values():
    assert job['runs-on'] == 'ubuntu-latest'
    assert 1 <= int(job['timeout-minutes']) <= 10
    for step in job['steps']:
        assert ('run' in step) != ('uses' in step)
        if 'uses' in step:
            assert re.fullmatch(r'[\w-]+/[\w-]+@[a-f0-9]{40}', step['uses'])
            uses.append(step['uses'].split('@')[0])
            pins.append(step['uses'])
assert set(uses) == {'actions/checkout', 'oven-sh/setup-bun', 'actions/upload-pages-artifact', 'actions/deploy-pages'}
assert workflow['jobs']['probe']['steps'][-3]['uses'].startswith('actions/upload-pages-artifact@')
assert workflow['jobs']['probe']['steps'][-3]['with']['path'] == 'public/dist'
remote = '--remote' in sys.argv
if remote:
    # A pinned SHA that does not exist upstream only fails when a runner sets up the job.
    for pin in pins:
        repo, sha = pin.split('@')
        found = subprocess.run(['gh', 'api', f'repos/{repo}/commits/{sha}', '--jq', '.sha'], capture_output=True, text=True)
        assert found.returncode == 0 and found.stdout.strip() == sha, f'{pin} does not resolve upstream'
print(f"Workflow YAML structure/security checks passed; {len(pins)} actions pinned; remote revisions {'resolved' if remote else 'not resolved (pass --remote)'}.")
