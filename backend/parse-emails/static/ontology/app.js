const graphContainer = document.querySelector('#cy');
const loadingView = document.querySelector('#graph-loading');
const errorView = document.querySelector('#graph-error');
const errorDetail = document.querySelector('#graph-error-detail');
const details = document.querySelector('#details-content');
const entityCount = document.querySelector('#entity-count');
const relationshipCount = document.querySelector('#relationship-count');
const jumpSelect = document.querySelector('#element-jump');
const fitButton = document.querySelector('#fit-graph');
const resetButton = document.querySelector('#reset-graph');

const NODE_TYPES = new Set(['actor', 'platform', 'server']);
const RELATIONSHIP_TYPES = new Set(['LOGS_INTO', 'PAYS', 'VIA', 'DEPENDS_ON', 'PROVIDED_BY', 'OPERATED_BY']);

const TYPE_DESCRIPTIONS = {
  actor: 'A person or external party that interacts with a platform or another actor.',
  platform: 'A business-facing technology system represented in the operating model.',
  server: 'Infrastructure required by a platform and potentially provided by a supplier.',
};

const RELATIONSHIP_DESCRIPTIONS = {
  LOGS_INTO: 'The source actor authenticates to the target platform.',
  PAYS: 'The source actor initiates a payment to the target actor.',
  VIA: 'The interaction is performed through the target platform.',
  DEPENDS_ON: 'The source platform requires the target infrastructure to operate.',
  PROVIDED_BY: 'The source infrastructure asset is supplied by the target party.',
  OPERATED_BY: 'The source infrastructure asset is actively operated by the target party.',
};

const PRESET_POSITIONS = {
  'actor:user': {x: 100, y: 145},
  'actor:employee': {x: 100, y: 430},
  'platform:e_banking': {x: 380, y: 145},
  'platform:hr': {x: 385, y: 365},
  'platform:crm': {x: 385, y: 505},
  'server:ebanking_primary': {x: 655, y: 145},
  'actor:supplier': {x: 900, y: 275},
};

let graph = null;
let ontology = null;

initialize();

async function initialize() {
  try {
    if (typeof window.cytoscape !== 'function') {
      throw new Error('The local graph library could not be loaded.');
    }

    const response = await fetch('ontology.json', {cache: 'no-store'});
    if (!response.ok) {
      throw new Error(`Ontology request failed with status ${response.status}.`);
    }

    const value = await response.json();
    validateOntology(value);
    ontology = value;
    graph = createGraph(value);
    populateJumpSelect(value);
    renderOverview(value);
    entityCount.textContent = String(value.nodes.length);
    relationshipCount.textContent = String(value.edges.length);
    setControlsEnabled(true);
    loadingView.hidden = true;

    requestAnimationFrame(() => fitGraph());
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : 'The graph data could not be loaded.');
  }
}

function validateOntology(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Ontology data must contain node and edge arrays.');
  }

  const nodeIds = new Set();
  for (const node of value.nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.label !== 'string' || !NODE_TYPES.has(node.type)) {
      throw new Error('Ontology data contains an invalid node.');
    }
    if (!Array.isArray(node.aliases)) {
      throw new Error(`Node ${node.id} must contain an aliases array.`);
    }
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate node ID: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  const elementIds = new Set(nodeIds);
  for (const edge of value.edges) {
    if (!edge || typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      throw new Error('Ontology data contains an invalid relationship.');
    }
    if (!RELATIONSHIP_TYPES.has(edge.relationship)) {
      throw new Error(`Unknown relationship type: ${edge.relationship}`);
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Relationship ${edge.id} references a missing node.`);
    }
    if (elementIds.has(edge.id)) {
      throw new Error(`Duplicate element ID: ${edge.id}`);
    }
    elementIds.add(edge.id);
  }
}

function createGraph(value) {
  const elements = [
    ...value.nodes.map((node, index) => ({
      data: {
        ...node,
        runtimeState: 'unknown',
      },
      position: PRESET_POSITIONS[node.id] || {x: 160 + index * 110, y: 280},
    })),
    ...value.edges.map((edge) => ({
      data: {
        ...edge,
        displayLabel: humanize(edge.relationship),
      },
    })),
  ];

  const cy = window.cytoscape({
    container: graphContainer,
    elements,
    layout: {name: 'preset', fit: true, padding: 65},
    minZoom: 0.45,
    maxZoom: 2.1,
    wheelSensitivity: 0.22,
    boxSelectionEnabled: false,
    selectionType: 'single',
    style: graphStyles(),
  });

  cy.on('tap', 'node, edge', (event) => {
    selectElement(event.target);
  });

  cy.on('tap', (event) => {
    if (event.target === cy) {
      clearSelection();
    }
  });

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(graphContainer);
  }

  return cy;
}

function graphStyles() {
  return [
    {
      selector: 'node',
      style: {
        width: 84,
        height: 84,
        'background-color': '#1768e5',
        'border-width': 3,
        'border-color': '#ffffff',
        'font-family': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        'font-size': 12,
        'font-weight': 700,
        color: '#142238',
        label: 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': 112,
        'text-valign': 'bottom',
        'text-margin-y': 12,
        'overlay-opacity': 0,
        'shadow-blur': 14,
        'shadow-color': '#142238',
        'shadow-opacity': 0.13,
        'shadow-offset-y': 4,
      },
    },
    {
      selector: 'node[type = "platform"]',
      style: {
        shape: 'round-rectangle',
        width: 118,
        height: 68,
        'background-color': '#65758b',
      },
    },
    {
      selector: 'node[type = "server"]',
      style: {
        shape: 'hexagon',
        width: 108,
        height: 82,
        'background-color': '#7257d5',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'curve-style': 'bezier',
        'line-color': '#aebac7',
        'target-arrow-color': '#7e8da0',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        label: 'data(displayLabel)',
        color: '#536275',
        'font-family': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        'font-size': 9,
        'font-weight': 700,
        'text-background-color': '#fbfcfd',
        'text-background-opacity': 0.95,
        'text-background-padding': 4,
        'text-rotation': 'autorotate',
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 5,
        'border-color': '#142238',
      },
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': '#1768e5',
        'target-arrow-color': '#1768e5',
        width: 4,
      },
    },
    {
      selector: '.dimmed',
      style: {
        opacity: 0.17,
      },
    },
    {
      selector: 'node[runtimeState = "watch"]',
      style: {
        'border-color': '#f59e0b',
        'border-width': 6,
      },
    },
    {
      selector: 'node[runtimeState = "critical"], node[runtimeState = "down"], .direct-impact',
      style: {
        'border-color': '#b42318',
        'border-width': 7,
        'line-color': '#b42318',
        'target-arrow-color': '#b42318',
      },
    },
    {
      selector: '.propagated-impact',
      style: {
        'border-color': '#d97706',
        'border-width': 6,
        'line-color': '#d97706',
        'target-arrow-color': '#d97706',
      },
    },
  ];
}

function populateJumpSelect(value) {
  const nodeGroup = document.createElement('optgroup');
  nodeGroup.label = 'Entities';
  for (const node of [...value.nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    nodeGroup.append(createOption(node.id, node.label));
  }

  const edgeGroup = document.createElement('optgroup');
  edgeGroup.label = 'Relationships';
  for (const edge of value.edges) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    edgeGroup.append(createOption(edge.id, `${source.label} → ${target.label} — ${humanize(edge.relationship)}`));
  }

  jumpSelect.append(nodeGroup, edgeGroup);
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function selectElement(element) {
  if (!graph || !element || element.empty()) return;

  graph.elements().unselect().addClass('dimmed');
  element.select();
  const focus = element.isNode()
    ? element.closedNeighborhood()
    : element.add(element.connectedNodes());
  focus.removeClass('dimmed');

  jumpSelect.value = element.id();
  if (element.isNode()) {
    renderNodeDetails(element.data());
  } else {
    renderEdgeDetails(element.data());
  }
}

function clearSelection() {
  if (!graph || !ontology) return;
  graph.elements().unselect().removeClass('dimmed');
  jumpSelect.value = '';
  renderOverview(ontology);
}

function fitGraph() {
  if (!graph) return;
  graph.resize();
  graph.fit(graph.elements(), 65);
}

function resetGraph() {
  if (!graph) return;
  graph.batch(() => {
    graph.nodes().forEach((node) => {
      const position = PRESET_POSITIONS[node.id()];
      if (position) node.position(position);
    });
  });
  clearSelection();
  fitGraph();
}

function renderOverview(value) {
  const counts = value.nodes.reduce((result, node) => {
    result[node.type] = (result[node.type] || 0) + 1;
    return result;
  }, {});

  const container = element('div', 'detail-intro');
  container.append(
    element('p', 'detail-kicker', 'Ontology overview'),
    element('h2', '', 'Explore the operating graph'),
    element('p', 'detail-description', 'Select an entity or relationship to inspect its ontology values and connected dependencies.'),
  );

  const grid = element('div', 'overview-grid');
  grid.append(
    overviewCard(counts.actor || 0, 'Actors'),
    overviewCard(counts.platform || 0, 'Platforms'),
    overviewCard(counts.server || 0, 'Servers'),
    overviewCard(value.edges.length, 'Relations'),
  );
  container.append(grid);
  container.append(element('p', 'detail-hint', 'Tip: select a node to isolate its immediate neighborhood, then choose a connected relationship for more detail.'));
  details.replaceChildren(container);
}

function renderNodeDetails(node) {
  const container = document.createDocumentFragment();
  container.append(
    badge(node.type, node.type),
    element('p', 'detail-kicker', 'Entity details'),
    element('h2', '', node.label),
    element('p', 'detail-description', TYPE_DESCRIPTIONS[node.type]),
  );

  const list = element('dl', 'detail-list');
  list.append(detailRow('Stable ID', node.id));
  list.append(detailRow('Aliases', node.aliases.length ? node.aliases.join(', ') : 'None'));
  if (node.type === 'server') {
    const status = element('span', 'status-unobserved', 'No live state observed');
    list.append(detailRow('Operational state', status));
  }
  container.append(list);

  const connected = ontology.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const relationSection = element('section', 'relation-section');
  relationSection.append(element('h3', '', `Connected relationships (${connected.length})`));
  const buttons = element('div', 'relation-buttons');
  for (const edge of connected) {
    const outgoing = edge.source === node.id;
    const otherNode = nodeById(outgoing ? edge.target : edge.source);
    const direction = outgoing ? `To ${otherNode.label}` : `From ${otherNode.label}`;
    const button = element('button', 'relation-button');
    button.type = 'button';
    button.append(
      element('strong', '', humanize(edge.relationship)),
      element('span', '', direction),
    );
    button.addEventListener('click', () => selectById(edge.id, true));
    buttons.append(button);
  }
  relationSection.append(buttons);
  container.append(relationSection);
  details.replaceChildren(container);
}

function renderEdgeDetails(edge) {
  const source = nodeById(edge.source);
  const target = nodeById(edge.target);
  const container = document.createDocumentFragment();
  container.append(
    badge('relationship', humanize(edge.relationship)),
    element('p', 'detail-kicker', 'Relationship details'),
    element('h2', '', `${source.label} → ${target.label}`),
    element('p', 'detail-description', RELATIONSHIP_DESCRIPTIONS[edge.relationship] || 'A directed relationship in the operating ontology.'),
  );

  const list = element('dl', 'detail-list');
  list.append(
    detailRow('Stable ID', edge.id),
    detailRow('Source', source.label),
    detailRow('Target', target.label),
    detailRow('Relationship', humanize(edge.relationship)),
  );

  const metadataEntries = Object.entries(edge.metadata || {});
  if (metadataEntries.length) {
    const chips = element('div', 'metadata-list');
    for (const [key, value] of metadataEntries) {
      chips.append(element('span', 'metadata-chip', `${humanize(key)}: ${value}`));
    }
    list.append(detailRow('Metadata', chips));
  }

  container.append(list);
  details.replaceChildren(container);
}

function selectById(id, center = false) {
  if (!graph) return;
  const selected = graph.getElementById(id);
  if (selected.empty()) return;
  selectElement(selected);
  if (center) graph.center(selected);
}

function detailRow(term, value) {
  const row = element('div', 'detail-row');
  row.append(element('dt', '', term));
  const description = element('dd');
  if (value instanceof Node) {
    description.append(value);
  } else {
    description.textContent = value;
  }
  row.append(description);
  return row;
}

function overviewCard(value, label) {
  const card = element('div', 'overview-card');
  card.append(element('strong', '', String(value)), element('span', '', label));
  return card;
}

function badge(className, label) {
  return element('span', `type-badge ${className}`, label);
}

function element(tag, className = '', text = '') {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function nodeById(id) {
  return ontology.nodes.find((node) => node.id === id);
}

function humanize(value) {
  return String(value)
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setControlsEnabled(enabled) {
  jumpSelect.disabled = !enabled;
  fitButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

function showError(message) {
  loadingView.hidden = true;
  errorDetail.textContent = message;
  errorView.hidden = false;
  setControlsEnabled(false);
  details.replaceChildren();
}

jumpSelect.addEventListener('change', () => {
  if (jumpSelect.value) {
    selectById(jumpSelect.value, true);
  } else {
    clearSelection();
  }
});

fitButton.addEventListener('click', fitGraph);
resetButton.addEventListener('click', () => {
  resetGraph();
});
