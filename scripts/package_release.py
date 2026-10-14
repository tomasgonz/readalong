# Readalong — Copyright © 2026 Tomas Gonzalez.
"""Build the manual-install archive from reviewed release files only."""
from pathlib import Path
import json
import zipfile
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
assert manifest['id'] == 'readalong'
files = ['main.js', 'manifest.json', 'README.md', 'LICENSE']
assert all((root / name).is_file() for name in files), 'Missing a release file'
out = root / 'dist'
out.mkdir(exist_ok=True)
with zipfile.ZipFile(out / 'readalong.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(out / 'readalong.zip')
