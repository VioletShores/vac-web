#!/usr/bin/env node
// ceremony-health-check.js — S158 ceremony self-testing: sensor 3 (auto-finding)
//
// Queries the backend for recent `greeting_audible` telemetry beacons and reports
// auto-findings: sessions where the ceremony greeting phase failed silently.
//
// WHAT IT FLAGS:
//   - analyser_frames === 0  → analyser was dead for the entire greeting
//     (D-GREETING-ANALYSER-SILENT-ADVANCE: iOS mic contention, flatline, suspension)
//   - timed_out === true && heard === false  → greeting phase hit PHRASE_PHASE_MAX_S
//     without detecting speech (broken mic, wrong permissions, or regression)
//   - no_analyser === true  → AudioContext never started (W4.1 fail-open)
//
// S207 (Rob approved, 24 Nov; independent review of vac-web #82):
//   - reading /v1/auth/debug needs the backend's ADMIN_INSPECT_TOKEN, sent as X-Admin-Token;
//   - the token is ONLY ever sent over https to an allow-listed BACKEND host (never to the
//     frontend host vacprotocol.org, which has no /v1 rewrite and would receive it);
//   - only a 200 whose body has an `events` ARRAY with at least one event is data. No token,
//     a refused token, a disallowed URL, an odd body or zero events all print
//     "NOT CHECKED", never "OK"/"healthy";
//   - session ids are aliased (s1, s2, ...) in the output.
//
// USAGE:
//   VAC_ADMIN_INSPECT_TOKEN=... node scripts/ceremony-health-check.js
//   VAC_DEBUG_API=https://vac-system-production.up.railway.app/v1/auth/debug HOURS=48 ...
//
// Exit code 0 = healthy, or NOT CHECKED (no data is not a failure). 1 = findings above the threshold.

'use strict';

const https = require('https');

const DEFAULT_API = 'https://vac-system-production.up.railway.app/v1/auth/debug';
// Backend hosts the admin token may be sent to. Nothing else, ever.
const TOKEN_HOSTS = ['vac-system-production.up.railway.app'];

const API_BASE  = process.env.VAC_DEBUG_API || DEFAULT_API;
const HOURS     = parseInt(process.env.HOURS || '24', 10);
const THRESHOLD = parseInt(process.env.ALERT_THRESHOLD || '3', 10);  // flag if ≥N problem sessions
const ADMIN_TOKEN = process.env.VAC_ADMIN_INSPECT_TOKEN || '';

// May the admin token be sent to this URL? https + an allow-listed backend host only.
function tokenAllowedFor(apiUrl) {
    let u;
    try { u = new URL(apiUrl); } catch (_) { return false; }
    return u.protocol === 'https:' && !u.username && !u.password &&
        (u.port === '' || u.port === '443') && TOKEN_HOSTS.indexOf(u.hostname) !== -1;
}

// The backend returns rows {event, session_id, context_json, created_at}; the browser beacon
// nests its fields under "context". Normalise to {event, session_id, created_at, context}.
function normaliseEvent(row) {
    if (!row || typeof row !== 'object') return null;
    let ctx = row.context;
    if (ctx === undefined && typeof row.context_json === 'string') {
        try { const p = JSON.parse(row.context_json); ctx = (p && p.context) || p; } catch (_) { ctx = undefined; }
    }
    return { event: row.event, session_id: row.session_id, created_at: row.created_at || row.ts, context: ctx || {} };
}

// Classify a fetched body. Only {events: [...]} with at least one greeting_audible event is data
// (the backend ignores ?event=, so filtering happens here).
function eventsFromBody(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.events)) {
        return { ok: false, why: 'the response had no events array' };
    }
    const events = data.events.map(normaliseEvent).filter(function (e) { return e && e.event === 'greeting_audible'; });
    if (events.length === 0) return { ok: false, why: 'the response had zero greeting_audible events' };
    return { ok: true, events: events };
}

function aliasSessions() {
    const map = new Map();
    return function (sid) {
        const key = sid == null ? '' : String(sid);
        if (!map.has(key)) map.set(key, 's' + (map.size + 1));
        return map.get(key);
    };
}

// Fetch recent greeting_audible events from the backend debug endpoint.
function fetchEvents(apiUrl, token, cb) {
    const parsed = new URL(apiUrl);
    parsed.searchParams.set('event', 'greeting_audible');
    parsed.searchParams.set('since_minutes', String(HOURS * 60));
    const req = https.get({
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: { 'Accept': 'application/json', 'User-Agent': 'ceremony-health-check/s207', 'X-Admin-Token': token },
        timeout: 10000,
    }, function(res) {
        let body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() {
            if (res.statusCode === 401 || res.statusCode === 403) {
                const e = new Error('unauthorized (HTTP ' + res.statusCode + ')'); e.unauthorized = true; return cb(e, null);
            }
            if (res.statusCode !== 200) return cb(new Error('HTTP ' + res.statusCode), null);
            try { cb(null, JSON.parse(body)); } catch(e) { cb(e, null); }
        });
    });
    req.on('error', cb);
    req.on('timeout', function() { req.destroy(new Error('timeout')); });
}

// Analyse a list of greeting_audible events for auto-findings (session ids aliased).
function analyseEvents(events) {
    const alias = aliasSessions();
    const findings = [];
    (events || []).forEach(function(ev) {
        const ctx = (ev && ev.context) || {};
        const sid = alias(ev && ev.session_id);
        const ts  = (ev && (ev.ts || ev.timestamp || ev.created_at)) || '';
        if (ctx.analyser_frames === 0) {
            findings.push({ type: 'D-GREETING-ANALYSER-SILENT-ADVANCE', session: sid, ts, detail: 'analyser was dead for the entire greeting phase (analyser_frames=0)' });
        } else if (ctx.timed_out && !ctx.heard) {
            findings.push({ type: 'D-GREETING-TIMEOUT-NO-SPEECH', session: sid, ts, detail: 'greeting timed out (PHRASE_PHASE_MAX_S) without detecting speech' });
        } else if (ctx.no_analyser) {
            findings.push({ type: 'D-GREETING-NO-ANALYSER', session: sid, ts, detail: 'W4.1 fail-open: AudioContext never started' });
        }
    });
    return findings;
}

// Turn one fetch outcome into the printed report and exit code. Pure, so it is unit-tested.
function report(err, data) {
    const lines = [];
    const notChecked = (why) => ({ code: 0, lines: ['[ceremony-health-check] NOT CHECKED: ' + why + '. No data was read; this is not a healthy result.'] });
    if (err && err.unauthorized) return notChecked('the backend refused the token (' + err.message + ')');
    if (err) return notChecked('the backend could not be read (' + (err.message || err) + ')');
    const got = eventsFromBody(data);
    if (!got.ok) return notChecked('no data: ' + got.why);
    const events = got.events;
    lines.push('[ceremony-health-check] ' + events.length + ' greeting_audible events in last ' + HOURS + 'h');
    const findings = analyseEvents(events);
    if (findings.length === 0) {
        lines.push('[ceremony-health-check] All ' + events.length + ' events healthy. No findings.');
        return { code: 0, lines };
    }
    lines.push('', '[ceremony-health-check] AUTO-FINDINGS (' + findings.length + ' sessions):');
    findings.forEach(function(f, i) {
        lines.push('  [' + (i+1) + '] ' + f.type, '      session: ' + f.session, '      ts:      ' + f.ts, '      detail:  ' + f.detail);
    });
    if (findings.length >= THRESHOLD) {
        lines.push('', '[ceremony-health-check] ALERT: ' + findings.length + ' problem sessions >= threshold ' + THRESHOLD + ' — investigate greeting audio path');
        return { code: 1, lines };
    }
    lines.push('', '[ceremony-health-check] ' + findings.length + ' finding(s) below alert threshold ' + THRESHOLD + '. Monitor for increase.');
    return { code: 0, lines };
}

function finish(r) { r.lines.forEach(function (l) { console.log(l); }); process.exit(r.code); }

if (require.main === module) {
    if (!ADMIN_TOKEN) {
        finish({ code: 0, lines: ['[ceremony-health-check] NOT CHECKED: VAC_ADMIN_INSPECT_TOKEN is not set, and reading /v1/auth/debug needs it. No data was read; this is not a healthy result.'] });
    } else if (!tokenAllowedFor(API_BASE)) {
        finish({ code: 0, lines: ['[ceremony-health-check] NOT CHECKED: VAC_DEBUG_API must be https on an allow-listed backend host (' + TOKEN_HOSTS.join(', ') + '); the admin token is not sent anywhere else. No data was read; this is not a healthy result.'] });
    } else {
        fetchEvents(API_BASE, ADMIN_TOKEN, function (err, data) { finish(report(err, data)); });
    }
}

module.exports = { fetchEvents, analyseEvents, tokenAllowedFor, eventsFromBody, normaliseEvent, report, aliasSessions, DEFAULT_API, TOKEN_HOSTS };
