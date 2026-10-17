/**
 * VAC Trust Graph Engine — D3 Force-Directed Network Visualisation
 * 
 * Production-grade trust graph renderer using D3.js.
 * Renders ego-centric view: current user at center, contacts around.
 * 
 * Usage:
 *   VACTrustGraph.render('#trustGraphSvg', {
 *     email: 'rob@violetshores.com',
 *     api: 'https://vac-system-production.up.railway.app'
 *   });
 * 
 * Patent claims: 272-285 (trust graph + vouch network)
 */

const VACTrustGraph = (function() {
    'use strict';

    const COLORS = {
        self:    { fill: 'rgba(45,212,191,0.15)', stroke: '#2DD4BF', text: '#2DD4BF' },
        mutual:  { fill: 'rgba(16,185,129,0.15)', stroke: '#10B981', text: '#10B981' },
        voucher: { fill: 'rgba(124,58,237,0.15)', stroke: '#7C3AED', text: '#7C3AED' },
        contact: { fill: 'rgba(107,114,128,0.15)', stroke: '#6B7280', text: '#6B7280' },
        outside: { fill: 'rgba(249,97,103,0.08)', stroke: '#F96167', text: '#F96167' },
    };

    const LINK_STYLES = {
        mutual:  { color: '#10B981', width: 2.5, dash: 'none', opacity: 0.8 },
        vouched: { color: '#7C3AED', width: 1.5, dash: '6,3', opacity: 0.5 },
        contact: { color: '#1E2230', width: 1, dash: '3,3', opacity: 0.3 },
    };

    // S199: /v1/user/{email} is owner-only (session Bearer) and no longer returns
    // contacts; contacts come from the session-gated /v1/user/{email}/contacts.
    // Token: options.token, else the page's sessionStorage convention.
    function sessionToken(email, token) {
        if (token) return token;
        try { return sessionStorage.getItem('vac_token_' + email) || ''; } catch (e) { return ''; }
    }

    async function fetchGraphData(email, api, token) {
        const t = sessionToken(email, token);
        const auth = t ? { headers: { 'Authorization': 'Bearer ' + t } } : {};
        const [profileResp, userResp, contactsResp] = await Promise.all([
            fetch(`${api}/v1/trust-profile/${encodeURIComponent(email)}`),
            t ? fetch(`${api}/v1/user/${encodeURIComponent(email)}`, auth).catch(() => null) : null,
            t ? fetch(`${api}/v1/user/${encodeURIComponent(email)}/contacts`, auth).catch(() => null) : null,
        ]);

        const profile = await profileResp.json();
        let user = { name: email.split('@')[0], email, trust_score: 0 };
        let contacts = [];

        if (userResp && userResp.ok) {
            const userData = await userResp.json();
            user = userData.user || user;
        }
        if (contactsResp && contactsResp.ok) {
            const contactsData = await contactsResp.json();
            contacts = contactsData.contacts || [];
        }

        // Merge vouch data from trust-profile
        const vouchesReceived = profile.vouches?.received || [];
        const vouchesGiven = profile.vouches?.given || [];

        return { user, contacts, vouchesReceived, vouchesGiven, profile };
    }

    function buildGraphModel(email, data) {
        const { user, contacts, vouchesReceived, vouchesGiven } = data;
        const nodes = [];
        const links = [];
        const nodeMap = new Set();

        // Root node: current user
        nodes.push({
            id: email,
            name: user.name || email.split('@')[0],
            score: user.trust_score || data.profile?.trust_score?.score || 0,
            type: 'self',
            radius: 32,
            verifications: user.total_verifications || 0,
            label: 'YOU',
        });
        nodeMap.add(email);

        // Add contacts
        contacts.forEach(c => {
            const isMutual = c.i_vouched && c.they_vouched;
            const type = isMutual ? 'mutual' : (c.they_vouched ? 'voucher' : 'contact');
            if (!nodeMap.has(c.email)) {
                nodes.push({
                    id: c.email,
                    name: c.name || c.email.split('@')[0],
                    score: c.trust_score || 0,
                    type: type,
                    radius: isMutual ? 24 : 20,
                    state: c.state,
                    label: isMutual ? 'MUTUAL' : (c.they_vouched ? 'VOUCHED' : 'CONTACT'),
                });
                nodeMap.add(c.email);
            }
            links.push({
                source: email,
                target: c.email,
                type: isMutual ? 'mutual' : (c.they_vouched ? 'vouched' : 'contact'),
                bidirectional: isMutual,
            });
        });

        // Add vouchers not already in contacts
        vouchesReceived.forEach(v => {
            if (!nodeMap.has(v.email)) {
                nodes.push({
                    id: v.email,
                    name: v.person || v.email.split('@')[0],
                    score: 0,
                    type: 'voucher',
                    radius: 20,
                    label: 'VOUCHED',
                });
                nodeMap.add(v.email);
                links.push({
                    source: email,
                    target: v.email,
                    type: 'vouched',
                    bidirectional: false,
                });
            }
        });

        // Add "outside" placeholder to show the boundary
        if (nodes.length >= 2) {
            nodes.push({
                id: '__outside__',
                name: 'Unknown',
                score: 0,
                type: 'outside',
                radius: 16,
                label: 'FULL VERIFY',
            });
            links.push({
                source: email,
                target: '__outside__',
                type: 'contact',
                bidirectional: false,
            });
        }

        return { nodes, links };
    }

    function render(selector, options = {}) {
        const { email, api = 'https://vac-system-production.up.railway.app' } = options;
        if (!email) return;

        const svgEl = document.querySelector(selector);
        if (!svgEl) return;

        fetchGraphData(email, api, options.token).then(data => {
            const { nodes, links } = buildGraphModel(email, data);
            drawGraph(svgEl, nodes, links, options);
        }).catch(err => {
            console.error('[TrustGraph] Error:', err);
            svgEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#6B7280" font-family="monospace" font-size="12">Could not load trust graph</text>';
        });
    }

    function drawGraph(svgEl, nodes, links, options = {}) {
        const svg = d3.select(svgEl);
        svg.selectAll('*').remove();

        const rect = svgEl.parentElement.getBoundingClientRect();
        const width = rect.width || 700;
        const height = parseInt(svgEl.style.height) || 300;
        svg.attr('viewBox', `0 0 ${width} ${height}`);
        svg.attr('width', width);
        svg.attr('height', height);

        // Defs for arrow markers and glow
        const defs = svg.append('defs');
        
        // Glow filter
        const glow = defs.append('filter').attr('id', 'glow');
        glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
        const merge = glow.append('feMerge');
        merge.append('feMergeNode').attr('in', 'coloredBlur');
        merge.append('feMergeNode').attr('in', 'SourceGraphic');

        // Force simulation
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(d => {
                if (d.type === 'mutual') return 100;
                if (d.type === 'vouched') return 130;
                return 160;
            }).strength(d => d.type === 'mutual' ? 0.6 : 0.3))
            .force('charge', d3.forceManyBody().strength(d => d.type === 'self' ? -300 : -150))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(d => d.radius + 15))
            .force('x', d3.forceX(width / 2).strength(0.05))
            .force('y', d3.forceY(height / 2).strength(0.05));

        // Links
        const linkG = svg.append('g').attr('class', 'links');
        const link = linkG.selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', d => LINK_STYLES[d.type]?.color || '#1E2230')
            .attr('stroke-width', d => LINK_STYLES[d.type]?.width || 1)
            .attr('stroke-dasharray', d => LINK_STYLES[d.type]?.dash || 'none')
            .attr('stroke-opacity', d => LINK_STYLES[d.type]?.opacity || 0.3);

        // Bidirectional indicators (small arrows for mutual)
        const linkLabels = linkG.selectAll('text')
            .data(links.filter(d => d.bidirectional))
            .join('text')
            .attr('text-anchor', 'middle')
            .attr('fill', '#10B981')
            .attr('font-size', '8px')
            .attr('font-family', 'monospace')
            .text('⟷');

        // Node groups
        const nodeG = svg.append('g').attr('class', 'nodes');
        const node = nodeG.selectAll('g')
            .data(nodes)
            .join('g')
            .attr('cursor', 'grab')
            .call(d3.drag()
                .on('start', (e, d) => {
                    if (!e.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x; d.fy = d.y;
                })
                .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
                .on('end', (e, d) => {
                    if (!e.active) simulation.alphaTarget(0);
                    d.fx = null; d.fy = null;
                })
            );

        // Outer ring (glow for self)
        node.filter(d => d.type === 'self').append('circle')
            .attr('r', d => d.radius + 6)
            .attr('fill', 'none')
            .attr('stroke', COLORS.self.stroke)
            .attr('stroke-width', 1)
            .attr('stroke-opacity', 0.3)
            .attr('filter', 'url(#glow)');

        // Main circle
        node.append('circle')
            .attr('r', d => d.radius)
            .attr('fill', d => COLORS[d.type]?.fill || COLORS.contact.fill)
            .attr('stroke', d => COLORS[d.type]?.stroke || COLORS.contact.stroke)
            .attr('stroke-width', d => d.type === 'self' ? 2.5 : 1.5);

        // Initial letter
        node.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.type === 'self' ? '-0.2em' : '-0.1em')
            .attr('fill', d => COLORS[d.type]?.text || '#6B7280')
            .attr('font-size', d => d.type === 'self' ? '16px' : '13px')
            .attr('font-weight', '700')
            .attr('font-family', 'monospace')
            .text(d => d.id === '__outside__' ? '?' : d.name.charAt(0).toUpperCase());

        // Name below initial
        node.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.type === 'self' ? '1.0em' : '0.9em')
            .attr('fill', d => COLORS[d.type]?.text || '#6B7280')
            .attr('font-size', d => d.type === 'self' ? '8px' : '7px')
            .attr('font-weight', '600')
            .attr('font-family', 'monospace')
            .text(d => {
                const name = d.name || '';
                return name.length > 14 ? name.substring(0, 14) + '…' : name;
            });

        // Label badge below name
        node.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.radius + 14)
            .attr('fill', d => {
                if (d.type === 'self') return '#2DD4BF';
                if (d.type === 'mutual') return '#10B981';
                if (d.type === 'voucher') return '#7C3AED';
                if (d.type === 'outside') return '#F96167';
                return '#6B7280';
            })
            .attr('font-size', '7px')
            .attr('font-weight', '700')
            .attr('font-family', 'monospace')
            .attr('letter-spacing', '1px')
            .text(d => d.label || '');

        // Trust score (small, below label)
        node.filter(d => d.score > 0).append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.radius + 23)
            .attr('fill', '#4B5563')
            .attr('font-size', '7px')
            .attr('font-family', 'monospace')
            .text(d => d.score.toFixed(2));

        // Tooltip on hover
        node.append('title')
            .text(d => {
                if (d.id === '__outside__') return 'Unknown contact — requires full 6-modality verification';
                let t = d.name + ' (' + d.id + ')';
                if (d.score > 0) t += '\nTrust score: ' + d.score.toFixed(2);
                if (d.type === 'mutual') t += '\nMutual vouch — streamlined verification';
                if (d.type === 'self') t += '\nYou — root of trust';
                return t;
            });

        // Tick
        simulation.on('tick', () => {
            const pad = 40;
            link
                .attr('x1', d => clamp(d.source.x, pad, width - pad))
                .attr('y1', d => clamp(d.source.y, pad, height - pad))
                .attr('x2', d => clamp(d.target.x, pad, width - pad))
                .attr('y2', d => clamp(d.target.y, pad, height - pad));

            linkLabels
                .attr('x', d => (d.source.x + d.target.x) / 2)
                .attr('y', d => (d.source.y + d.target.y) / 2);

            node.attr('transform', d =>
                `translate(${clamp(d.x, pad, width - pad)},${clamp(d.y, pad, height - pad)})`
            );
        });

        // Legend
        const legend = svg.append('g')
            .attr('transform', `translate(12, ${height - 50})`);

        const legendItems = [
            { color: '#2DD4BF', label: 'You (root)' },
            { color: '#10B981', label: 'Mutual vouch' },
            { color: '#7C3AED', label: 'Vouched for you' },
            { color: '#F96167', label: 'Outside graph' },
        ];

        legendItems.forEach((item, i) => {
            const g = legend.append('g').attr('transform', `translate(${i * 110}, 0)`);
            g.append('circle').attr('r', 4).attr('fill', item.color).attr('cy', 0);
            g.append('text')
                .attr('x', 8)
                .attr('dy', '0.35em')
                .attr('fill', '#6B7280')
                .attr('font-size', '8px')
                .attr('font-family', 'monospace')
                .text(item.label);
        });

        // "Inside graph = cheap verification" annotation
        const annotation = svg.append('g')
            .attr('transform', `translate(12, ${height - 30})`);
        annotation.append('text')
            .attr('fill', '#4B5563')
            .attr('font-size', '8px')
            .attr('font-family', 'monospace')
            .text('Inside trust graph → streamlined verification · Outside → full 6-modality verification required');
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    return { render, fetchGraphData, buildGraphModel };
})();
