#!/usr/bin/env node
// sync-company-facts.js — copy the Athena Data facts snapshot into the site.
//
//   node scripts/sync-company-facts.js /path/to/company-facts.json
//
// Writes data/company-facts.json with ONLY public:true facts. A fact's
// `source` that points into a private repository (owner/repo@sha:path) is
// replaced by a neutral label, because the site file is publicly readable;
// public sources (for example datatracker.ietf.org) are kept as they are.
'use strict';
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('usage: sync-company-facts.js <snapshot.json>'); process.exit(2); }
const snap = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!snap || typeof snap.facts !== 'object') { console.error('snapshot has no facts object'); process.exit(1); }

const PRIVATE_SOURCE = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(@[0-9a-f]{6,}|:)|branch\s/;
const out = { generated_at: snap.generated_at || null, facts: {} };
let kept = 0, dropped = 0, relabelled = 0;
for (const [key, fact] of Object.entries(snap.facts)) {
  if (!fact || fact.public !== true) { dropped++; continue; }
  const f = { ...fact };
  if (typeof f.source === 'string') {
    // A public source stays, minus any private reference appended to it;
    // a source that is private anywhere else is relabelled whole.
    const s = f.source;
    const cut = s.search(/\s\+\s[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+[@:\s]/);
    if (/^datatracker\.ietf\.org/.test(s)) {
      if (cut > 0) { f.source = s.slice(0, cut); relabelled++; }
    } else if (PRIVATE_SOURCE.test(s) || /\.md\b|\.py\b|\/docs\//.test(s)) {
      f.source = 'Athena Data (internal record)';
      relabelled++;
    }
  }
  out.facts[key] = f;
  kept++;
}
const dest = path.resolve(__dirname, '..', 'data', 'company-facts.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${dest}: ${kept} public facts, ${dropped} non-public dropped, ${relabelled} sources relabelled`);
