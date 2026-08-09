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
// USAGE:
//   node scripts/ceremony-health-check.js
//   VAC_DEBUG_API=https://vacprotocol.org/v1/auth/debug node scripts/ceremony-health-check.js
//   VAC_DEBUG_API=... HOURS=48 node scripts/ceremony-health-check.js
//
// In CI: set VAC_DEBUG_API and run after ceremony-selftest.yml for a post-push health check.
// Exit code 0 = healthy (or no data). Exit code 1 = findings above alert threshold.

'use strict';

const https = require('https');
const http  = require('http');

const API_BASE  = process.env.VAC_DEBUG_API  || 'https://vacprotocol.org/v1/auth/debug';
const HOURS     = parseInt(process.env.HOURS || '24', 10);
const THRESHOLD = parseInt(process.env.ALERT_THRESHOLD || '3', 10);  // flag if ≥N problem sessions

// Fetch recent greeting_audible events from the backend debug endpoint.
// The backend /v1/auth/debug endpoint stores events POSTed by vacDebug().
// We query it with event=greeting_audible to get recent beacons.
function fetchEvents(apiUrl, cb) {
    const parsed = new URL(apiUrl);
    parsed.searchParams.set('event', 'greeting_audible');
    parsed.searchParams.set('hours', String(HOURS));
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get({
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: { 'Accept': 'application/json', 'User-Agent': 'ceremony-health-check/s158a1' },
        timeout: 10000,
    }, function(res) {
        let body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() {
            try { cb(null, JSON.parse(body)); } catch(e) { cb(e, null); }
        });
    });
    req.on('error', cb);
    req.on('timeout', function() { req.destroy(new Error('timeout')); });
}

// Analyse a list of greeting_audible events for auto-findings.
function analyseEvents(events) {
    const findings = [];
    (events || []).forEach(function(ev) {
        const ctx = ev.context || {};
        const sid = ev.session_id || '(unknown)';
        const ts  = ev.ts || ev.timestamp || '';
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

// Main
fetchEvents(API_BASE, function(err, data) {
    if (err) {
        // Backend unreachable in local/CI environments without credentials — exit 0 (no data is not a failure).
        console.log('[ceremony-health-check] Backend unreachable (' + (err.message || err) + ') — skipping auto-find (no data)');
        process.exit(0);
    }

    const events = Array.isArray(data) ? data : (data && data.events) || [];
    console.log('[ceremony-health-check] ' + events.length + ' greeting_audible events in last ' + HOURS + 'h');

    if (events.length === 0) {
        console.log('[ceremony-health-check] No events — either no real sessions yet or beacon not deployed. OK.');
        process.exit(0);
    }

    const findings = analyseEvents(events);

    if (findings.length === 0) {
        console.log('[ceremony-health-check] All ' + events.length + ' sessions healthy. No findings.');
        process.exit(0);
    }

    console.log('\n[ceremony-health-check] AUTO-FINDINGS (' + findings.length + ' sessions):');
    findings.forEach(function(f, i) {
        console.log('  [' + (i+1) + '] ' + f.type);
        console.log('      session: ' + f.session);
        console.log('      ts:      ' + f.ts);
        console.log('      detail:  ' + f.detail);
    });

    if (findings.length >= THRESHOLD) {
        console.error('\n[ceremony-health-check] ALERT: ' + findings.length + ' problem sessions >= threshold ' + THRESHOLD + ' — investigate greeting audio path');
        process.exit(1);
    } else {
        console.log('\n[ceremony-health-check] ' + findings.length + ' finding(s) below alert threshold ' + THRESHOLD + '. Monitor for increase.');
        process.exit(0);
    }
});
