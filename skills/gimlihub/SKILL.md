---
name: gimlihub
description: Use the GimliHub CLI to search, install, update, and publish agent skills from gimlihub.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed gimlihub CLI.
metadata: {"gimli":{"requires":{"bins":["gimlihub"]},"install":[{"id":"node","kind":"node","package":"gimlihub","bins":["gimlihub"],"label":"Install GimliHub CLI (npm)"}]}}
---

# GimliHub CLI

Install
```bash
npm i -g gimlihub
```

Auth (publish)
```bash
gimlihub login
gimlihub whoami
```

Search
```bash
gimlihub search "postgres backups"
```

Install
```bash
gimlihub install my-skill
gimlihub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)
```bash
gimlihub update my-skill
gimlihub update my-skill --version 1.2.3
gimlihub update --all
gimlihub update my-skill --force
gimlihub update --all --no-input --force
```

List
```bash
gimlihub list
```

Publish
```bash
gimlihub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes
- Default registry: https://gimlihub.com (override with GIMLIHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to Gimli workspace); install dir: ./skills (override with --workdir / --dir / GIMLIHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
