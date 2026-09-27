const $ = (s) => document.querySelector(s);
const ui = {
  cy: $('#cy'), loading: $('#graph-loading'), error: $('#graph-error'), errorText: $('#graph-error-detail'), details: $('#details-content'),
  entities: $('#entity-count'), relations: $('#relationship-count'), jump: $('#element-jump'), fit: $('#fit-graph'), resetGraph: $('#reset-graph'),
  status: $('#simulation-status'), clock: $('#simulation-clock'), processed: $('#processed-count'), total: $('#total-ticket-count'),
  progress: $('#progress-fill'), speed: $('#speed-select'), next: $('#next-ticket'), play: $('#play-simulation'), reset: $('#reset-simulation'),
  feedCount: $('#feed-count'), ticketList: $('#ticket-list'),
};
const POS = {
  'actor:user': {x: 90, y: 130}, 'actor:employee': {x: 90, y: 430}, 'platform:e_banking': {x: 360, y: 130},
  'platform:hr': {x: 360, y: 350}, 'platform:crm': {x: 360, y: 500}, 'platform:accounts_payable': {x: 650, y: 445},
  'server:ebanking_primary': {x: 640, y: 130}, 'actor:supplier': {x: 900, y: 285},
};
const WINDOW_MINUTES = 30;
const WATCH = 10, CRITICAL = 20, WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
let cy, ontology, tickets = [], cursor = 0, timer = null, clusters = new Map(), recent = [];

init();

async function init() {
  try {
    const [or, tr] = await Promise.all([fetch('ontology.json', {cache: 'no-store'}), fetch('email_ticket_pairs.json', {cache: 'no-store'})]);
    if (!or.ok || !tr.ok) throw new Error('Could not load the demo data.');
    const ticketData = await tr.json();
    ontology = await or.json(); tickets = Array.isArray(ticketData) ? ticketData.map((pair) => pair.ticket) : ticketData.tickets || [];
    cy = makeGraph(); populateJump();
    ui.entities.textContent = ontology.nodes.length; ui.relations.textContent = ontology.edges.length; ui.total.textContent = tickets.length;
    [ui.jump, ui.fit, ui.resetGraph, ui.next, ui.play, ui.reset].forEach((x) => x.disabled = false);
    resetSimulation(); ui.loading.hidden = true; requestAnimationFrame(fitGraph);
  } catch (e) { ui.loading.hidden = true; ui.error.hidden = false; ui.errorText.textContent = e.message; }
}

function makeGraph() {
  const elements = [
    ...ontology.nodes.map((x) => ({data: {...x, ticketCount: 0}, position: POS[x.id]})),
    ...ontology.edges.map((x) => ({data: {...x, displayLabel: humanize(x.relationship), ticketCount: 0}})),
  ];
  const graph = cytoscape({container: ui.cy, elements, layout: {name: 'preset'}, minZoom: .45, maxZoom: 2, wheelSensitivity: .22,
    boxSelectionEnabled: false, style: graphStyles()});
  graph.on('tap', 'node, edge', (e) => selectElement(e.target));
  graph.on('tap', (e) => { if (e.target === graph) showOverview(); });
  return graph;
}

function graphStyles() {
  const out = [
    {selector: 'node', style: {width: 84, height: 84, 'background-color': '#a8b1bc', 'border-width': 3, 'border-color': '#fff',
      label: 'data(label)', color: '#142238', 'font-size': 12, 'font-weight': 700, 'text-wrap': 'wrap', 'text-max-width': 115,
      'text-valign': 'bottom', 'text-margin-y': 12, 'overlay-opacity': 0, 'shadow-blur': 12, 'shadow-opacity': .12}},
    {selector: 'node[type="platform"]', style: {shape: 'round-rectangle', width: 122, height: 70}},
    {selector: 'node[type="server"]', style: {shape: 'hexagon', width: 108, height: 82}},
    {selector: 'edge', style: {width: 3, 'curve-style': 'bezier', 'line-color': '#a8b1bc', 'target-arrow-color': '#a8b1bc',
      'target-arrow-shape': 'triangle', label: 'data(displayLabel)', color: '#536275', 'font-size': 9, 'font-weight': 700,
      'text-background-color': '#fbfcfd', 'text-background-opacity': .95, 'text-background-padding': 4, 'text-rotation': 'autorotate', 'overlay-opacity': 0}},
    {selector: '.dimmed', style: {opacity: .15}},
    {selector: 'node:selected', style: {'border-width': 6, 'border-color': '#142238'}},
    {selector: 'edge:selected', style: {width: 6}},
  ];
  const levels = [
    ['[ticketCount > 0][ticketCount < 5]','#fde68a'],
    ['[ticketCount >= 5][ticketCount < 10]','#facc15'],
    ['[ticketCount >= 10][ticketCount < 15]','#f59e0b'],
    ['[ticketCount >= 15][ticketCount < 20]','#ea580c'],
    ['[ticketCount >= 20]','#991b1b'],
  ];
  levels.forEach(([q,color], i) => {
    out.push({selector: `node${q}`, style: {'background-color': color}});
    out.push({selector: `edge${q}`, style: {'line-color': color, 'target-arrow-color': color, width: 3 + i * .45}});
  });
  out.push({selector: '.cluster-critical', style: {'background-color': '#7f1d1d', 'line-color': '#7f1d1d',
    'target-arrow-color': '#7f1d1d', 'border-color': '#450a0a', 'border-width': 7, width: 7}});
  return out;
}

function processNext() {
  if (cursor >= tickets.length) return stop('Replay complete');
  const ticket = tickets[cursor++], v = ticket.ontology_values;
  const ids = [...new Set([...(v.actor_ids||[]), ...(v.platform_ids||[]), ...(v.server_ids||[]), ...(v.supplier_ids||[]), ...(v.edge_ids||[])])];
  const key = clusterKey(ticket);
  if (key && v.symptom !== 'unknown') {
    const cluster = clusters.get(key) || {key, tickets: [], peakTickets: [], peakCount: 0, status: 'normal', affected: new Set()};
    cluster.tickets.push(ticket); ids.forEach((id) => cluster.affected.add(id)); clusters.set(key, cluster);
  }
  recent.unshift(ticket); recent = recent.slice(0, 5);
  const hit = refreshClusters(new Date(ticket.received_at));
  renderProgress(ticket); renderFeed(); if (hit) renderCluster(hit);
  if (cursor >= tickets.length) stop('Replay complete');
}

function clusterKey(t) {
  const v = t.ontology_values; if (!v.primary_affected_node_id) return null;
  return [v.primary_affected_node_id, (v.relationship_types||[])[0]||'NONE', v.symptom, v.channel, v.error_code||'NONE'].join('|');
}

function refreshClusters(now) {
  let hit = null; cy.elements().removeClass('cluster-critical');
  clusters.forEach((c) => {
    c.windowTickets = c.tickets.filter((t) => now - new Date(t.received_at) <= WINDOW_MS);
    if (c.windowTickets.length > c.peakCount) {
      c.peakCount = c.windowTickets.length;
      c.peakTickets = [...c.windowTickets];
    }
    const before = c.status; c.status = c.peakCount >= CRITICAL ? 'critical' : c.peakCount >= WATCH ? 'watch' : 'normal';
    if (c.status === 'critical') { c.affected.forEach((id) => cy.getElementById(id).addClass('cluster-critical')); if (before !== 'critical') hit = c; }
  });
  cy.batch(() => {
    cy.elements().forEach((x) => x.data('ticketCount', 0));
    clusters.forEach((c) => c.affected.forEach((id) => {
      const x = cy.getElementById(id);
      if (!x.empty()) x.data('ticketCount', Math.max(+x.data('ticketCount'), c.peakCount));
    }));
  });
  return hit;
}

function renderProgress(ticket) {
  const count = [...clusters.values()].filter((c) => c.status === 'critical').length;
  ui.processed.textContent = cursor; ui.progress.style.width = `${cursor / tickets.length * 100}%`;
  ui.clock.textContent = new Date(ticket.received_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  ui.status.textContent = count ? `${count} critical cluster${count === 1 ? '' : 's'} detected` : 'Monitoring ticket stream';
  $('.status-dot').classList.toggle('critical', Boolean(count));
}

function renderFeed() {
  ui.feedCount.textContent = `${cursor} processed`;
  ui.ticketList.replaceChildren(...recent.map((t) => {
    const card = el('article','ticket-card'), v = t.ontology_values, tags = el('div','ticket-tags');
    tags.append(el('span','ticket-tag',humanize(v.symptom)), el('span','ticket-tag',v.error_code||'No code'));
    card.append(el('span','ticket-time',new Date(t.received_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})), tags,
      el('strong','',t.id), el('p','',t.summary)); return card;
  }));
}

function renderCluster(c) {
  const sample = c.peakTickets.at(-1) || c.tickets.at(-1), v = sample.ontology_values, count = c.peakCount;
  let title = `${humanize(v.symptom)} on ${nodeLabel(v.primary_affected_node_id)}`;
  let cause = `The shared ${humanize(v.channel)} channel and ${v.error_code||'symptom'} signature indicate one recurring operational fault.`;
  let fix = 'Assign the cluster to the platform owner, compare the first failure with recent changes, and validate recovery with a canary test.';
  if (v.error_code === 'A17') { title = 'iOS login failures spike after release 6.4.0'; cause = 'All 25 reports started after the iOS rollout and share error A17, while Android and web remain healthy. The release configuration likely contains the test authentication endpoint instead of the production endpoint—a common environment-copy mistake.'; fix = 'Pause the iOS rollout and publish a 6.4.1 hotfix with the production authentication endpoint. Verify login with a small canary group and resume only after the A17 rate returns to baseline.'; }
  if (v.error_code === 'INFRA-001') { title = 'Primary E-Banking server is unreachable'; cause = 'Repeated health-check timeouts point to srv-eb-01 or its supplier-provided connectivity—not isolated user error.'; fix = 'Isolate srv-eb-01, shift traffic to healthy capacity, and engage the infrastructure supplier.'; }
  const p = el('div','critical-panel');
  p.append(el('span','critical-badge','Critical cluster'), el('p','detail-kicker','AI risk insight'), el('h2','',title),
    el('p','cluster-metric',`${count} matching tickets in ${WINDOW_MINUTES} minutes · threshold ${CRITICAL}`),
    insight('Identified issue', v.error_code === 'A17'
      ? `${count} customers cannot sign in to E-Banking on iOS after installing version 6.4.0. Every ticket contains error A17; no matching spike appears on Android or web.`
      : `${sample.summary} The pattern repeats across ${count} model-normalized tickets.`),
    insight('Potential root cause',cause), insight('Suggested fix',fix));
  const button = el('button','fix-button','Apply suggested fix'); button.type = 'button';
  p.append(button, el('p','demo-note','Demo action only — no change will be made.')); ui.details.replaceChildren(p);
}

function insight(title, text) { const x = el('section','insight'); x.append(el('h3','',title),el('p','',text)); return x; }

function selectElement(target) {
  cy.elements().unselect().addClass('dimmed'); target.select();
  (target.isNode() ? target.closedNeighborhood() : target.add(target.connectedNodes())).removeClass('dimmed'); ui.jump.value = target.id();
  const c = [...clusters.values()].filter((x) => x.status === 'critical' && x.affected.has(target.id())).sort((a,b) => b.windowTickets.length-a.windowTickets.length)[0];
  if (c) return renderCluster(c);
  const d = target.data(), p = el('div','detail-intro');
  p.append(el('p','detail-kicker',target.isNode()?'Entity details':'Relationship details'),
    el('h2','',target.isNode()?d.label:`${nodeLabel(d.source)} → ${nodeLabel(d.target)}`),
    el('p','detail-description',`${d.ticketCount} processed ticket${d.ticketCount===1?'':'s'} tagged this ontology value.`)); ui.details.replaceChildren(p);
}

function showOverview() {
  if (!cy) return; cy.elements().unselect().removeClass('dimmed'); ui.jump.value = '';
  const count = [...clusters.values()].filter((c) => c.status === 'critical').length, p = el('div','detail-intro');
  p.append(el('p','detail-kicker','Live ontology'),el('h2','','Ticket intelligence simulation'),
    el('p','detail-description','Press Play to replay model-1 tickets. Repeated ontology tags build intensity from grey through yellow and orange to red.'));
  if (count) p.append(el('p','detail-hint',`${count} critical cluster detected. Select a red entity or relationship to inspect it.`)); ui.details.replaceChildren(p);
}

function populateJump() {
  ontology.nodes.forEach((n) => ui.jump.append(new Option(n.label,n.id)));
  ontology.edges.forEach((e) => ui.jump.append(new Option(`${nodeLabel(e.source)} → ${nodeLabel(e.target)}`,e.id)));
}
function play() { if (timer) return pause(); ui.play.textContent='Pause'; const tick=()=>{ processNext(); if(cursor<tickets.length&&ui.play.textContent==='Pause') timer=setTimeout(tick,700/+ui.speed.value); }; timer=setTimeout(tick,80); }
function pause() { clearTimeout(timer); timer=null; ui.play.textContent='Play'; }
function stop(label) { pause(); ui.status.textContent=label; }
function resetSimulation() {
  pause(); cursor=0; clusters=new Map(); recent=[];
  if(cy) cy.elements().forEach((x)=>{x.data('ticketCount',0);x.removeClass('cluster-critical dimmed');});
  ui.processed.textContent='0';ui.progress.style.width='0%';ui.status.textContent='Simulation ready';ui.clock.textContent='Waiting for first ticket';ui.feedCount.textContent='No tickets yet';
  ui.ticketList.replaceChildren(el('p','ticket-empty','Press Play to begin the timestamped replay.')); showOverview();
}
function fitGraph(){if(cy){cy.resize();cy.fit(cy.elements(),60);}}
function nodeLabel(id){return ontology.nodes.find((n)=>n.id===id)?.label||id;}
function humanize(v){return String(v).replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());}
function el(tag,className='',text=''){const x=document.createElement(tag);x.className=className;x.textContent=text;return x;}

ui.play.addEventListener('click',play); ui.next.addEventListener('click',()=>{pause();processNext();}); ui.reset.addEventListener('click',resetSimulation);
ui.fit.addEventListener('click',fitGraph); ui.resetGraph.addEventListener('click',()=>{cy.nodes().forEach((n)=>n.position(POS[n.id()]));fitGraph();showOverview();});
ui.jump.addEventListener('change',()=>ui.jump.value?selectElement(cy.getElementById(ui.jump.value)):showOverview());
window.addEventListener('resize', () => requestAnimationFrame(fitGraph));
