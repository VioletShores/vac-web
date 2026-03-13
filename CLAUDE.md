# Claude Code Instructions for vac-web

## Deploy Rules
- Push directly to main. Do NOT create pull requests.
- Vercel auto-deploys from main. PRs create preview deployments that don't go live.
- After making changes: git add, commit, push to main.
- vercel.json has explicit rewrites for every page — if you add a new HTML file, add a rewrite entry in vercel.json too.
