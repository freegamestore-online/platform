import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const storefront = readFileSync(new URL('../storefront.js', import.meta.url), 'utf8');
const search = readFileSync(new URL('../search.js', import.meta.url), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));
function element(extra = {}) {
  const classes = new Set();
  return {
    hidden: false,
    dataset: {},
    handlers: {},
    attributes: {},
    style: {},
    textContent: '',
    classList: {
      add(x) {
        classes.add(x);
      },
      remove(x) {
        classes.delete(x);
      },
      toggle(x, on) {
        on ? classes.add(x) : classes.delete(x);
      },
      contains(x) {
        return classes.has(x);
      },
    },
    addEventListener(type, fn) {
      (this.handlers[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      this.handlers[type] = (this.handlers[type] || []).filter((x) => x !== fn);
    },
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return k.startsWith('data-') ? this.dataset[k.slice(5)] : this.attributes[k];
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    appendChild() {},
    scrollIntoView() {},
    focus() {
      this.focused = true;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    ...extra,
  };
}
function event(target, key) {
  return {
    target,
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}
function fire(node, type, e = event(node)) {
  for (const fn of node.handlers[type] || []) fn(e);
}
function setup({ desktop = true, query = '', crossRegistry = null, isolated = [] } = {}) {
  const location = {
    href: `https://freegamestore.online/${query}`,
    get search() {
      return new URL(this.href).search;
    },
  };
  const layout = element();
  const fullscreens = [];
  const frame = element({
    requestFullscreen() {
      fullscreens.push(true);
    },
  });
  const cards = [
    ['chess', 'Chess', 'strategy', '2026-01-01', 'Think ahead'],
    ['arcade', 'Arcade', 'arcade', '2026-10-01', 'Quick reflexes'],
    ['blocks', 'Blocks', 'strategy', '', 'Stack blocks'],
  ].map(([id, name, category, published, description]) => {
    const cta = element({
      getAttribute: () => `https://${id}.freegamestore.online`,
      closest: (s) => (s === '.app-cta' ? cta : null),
    });
    return element({
      dataset: { id, name, category, published, description, about: `/games/${id}`, isolated: String(isolated.includes(id)) },
      textContent: `${name} ${category}`,
      querySelector: (s) => s === '.app-cta' ? cta : s === '.preview-capabilities' && id === 'chess'
        ? { textContent: 'Microphone unavailable in preview. Play in a new tab to use supported features; your browser may ask for permission. Payments are never supported.' } : null,
      closest() {
        return null;
      },
    });
  });
  const grid = element({
    querySelectorAll: () => [...cards],
    appendChild(card) {
      cards.splice(cards.indexOf(card), 1);
      cards.push(card);
    },
  });
  const sortButtons = ['name', 'newest', 'category'].map((sort) =>
    element({
      dataset: { sort },
      closest() {
        return this;
      },
    }),
  );
  const genreButtons = ['all', 'strategy', 'arcade'].map((category) =>
    element({
      dataset: { category },
      closest() {
        return this;
      },
    }),
  );
  const elements = {
    'apps-grid': grid,
    'apps-count': element(),
    'search-empty': element(),
    'storefront-search': element({ value: '' }),
    'cross-store-results': element(),
    'cross-store-grid': element(),
    categoryFilter: element({ querySelectorAll: () => genreButtons }),
    sortBar: element({ querySelectorAll: () => sortButtons }),
    previewPane: element({ parentElement: layout }),
    previewFrame: frame,
    previewEmpty: element(),
    previewTitle: element(),
    previewNewTab: element(),
    previewAbout: element(),
    previewClose: element(),
    previewFullscreen: element(),
    previewCapabilities: element({ hidden: true }),
  };
  if (crossRegistry) elements['cross-store-registry'] = element({ textContent: JSON.stringify(crossRegistry) });
  elements['cross-store-grid'].children = [];
  elements['cross-store-grid'].appendChild = (card) => elements['cross-store-grid'].children.push(card);
  const mq = element({ matches: desktop });
  const opened = [];
  const requests = [];
  const context = {
    URL,
    URLSearchParams,
    CSS: { escape: (x) => x },
    window: {
      location,
      matchMedia: () => mq,
      open(...args) {
        opened.push(args);
      },
    },
    history: {
      replaceState(a, b, url) {
        location.href = new URL(url, location.href).href;
      },
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    fetch(url) {
      requests.push(url);
      return Promise.resolve({ ok: true });
    },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelectorAll(s) {
        return s.includes('is-active')
          ? cards.filter((c) => c.classList.contains('is-active'))
          : [...cards];
      },
      querySelector(s) {
        return cards.find((c) => s.includes(`data-id="${c.dataset.id}"`)) || null;
      },
      createTextNode: (text) => ({ textContent: text }),
      createElement: () => element(),
    },
  };
  context.window.history = context.history;
  runInNewContext(search, context); // template defer ordering
  runInNewContext(storefront, context);
  return {
    cards,
    elements,
    layout,
    frame,
    mq,
    sortButtons,
    genreButtons,
    requests,
    opened,
    fullscreens,
    location,
  };
}

test('catalogue defaults to newest and preserves explicit sort/search links', () => {
  const ui = setup();
  assert.deepEqual(
    ui.cards.map((c) => c.dataset.id),
    ['arcade', 'chess', 'blocks'],
  );
  assert.equal(ui.layout.classList.contains('has-preview'), false);
  const az = setup({ query: '?q=blocks&sort=name' });
  assert.deepEqual(
    az.cards.map((c) => c.dataset.id),
    ['arcade', 'blocks', 'chess'],
  );
  assert.equal(new URL(az.location.href).searchParams.get('q'), 'blocks');
  assert.equal(az.elements['apps-count'].textContent, '1 of 3 games');
  assert.equal(az.sortButtons[0].attributes['aria-pressed'], 'true');
});
test('genre filters combine with description search and update counts/empty states', () => {
  const ui = setup();
  fire(ui.elements.categoryFilter, 'click', event(ui.genreButtons[1]));
  assert.equal(ui.elements['apps-count'].textContent, '2 of 3 games');
  const input = ui.elements['storefront-search'];
  input.value = 'reflexes';
  fire(input, 'input');
  assert.equal(ui.elements['apps-count'].textContent, '0 of 3 games');
  assert.equal(ui.elements['search-empty'].hidden, false);
  fire(ui.elements.categoryFilter, 'click', event(ui.genreButtons[0]));
  assert.equal(ui.elements['apps-count'].textContent, '1 of 3 games');
  assert.equal(ui.genreButtons[0].attributes['aria-pressed'], 'true');
  input.value = '';
  fire(input, 'input');
  assert.equal(ui.elements['apps-count'].textContent, '3 games');
  assert.equal(ui.elements['search-empty'].hidden, true);
});
test('keyboard preview keeps fullscreen/new-tab; close restores catalogue, focus and URL', async () => {
  const ui = setup({ query: '?q=chess' });
  const card = ui.cards.find((c) => c.dataset.id === 'chess');
  fire(card, 'keydown', event(card, 'Enter'));
  await settle();
  assert.equal(ui.layout.classList.contains('has-preview'), true);
  assert.equal(ui.frame.src, 'https://chess.freegamestore.online');
  assert.equal(ui.elements.previewCapabilities.hidden, false);
  assert.match(ui.elements.previewCapabilities.textContent, /Microphone unavailable in preview/);
  fire(ui.elements.previewFullscreen, 'click');
  assert.equal(ui.fullscreens.length, 1);
  fire(ui.elements.previewNewTab, 'click');
  assert.equal(ui.opened[0][0], 'https://chess.freegamestore.online');
  assert.deepEqual(ui.opened[0], ['https://chess.freegamestore.online', '_blank', 'noopener']);
  fire(ui.elements.previewClose, 'click');
  assert.equal(ui.layout.classList.contains('has-preview'), false);
  assert.equal(ui.frame.hidden, true);
  assert.equal(ui.elements.previewCapabilities.hidden, true);
  assert.equal(card.focused, true);
  assert.equal(new URL(ui.location.href).searchParams.get('q'), 'chess');
  assert.equal(new URL(ui.location.href).searchParams.has('game'), false);
});

test('preview capability messaging follows selection and deep links without stale warnings', async () => {
  const ui = setup({ query: '?game=chess' });
  await settle();
  assert.match(ui.elements.previewCapabilities.textContent, /Microphone unavailable/);
  fire(ui.cards.find((card) => card.dataset.id === 'arcade'), 'keydown', event(ui.cards.find((card) => card.dataset.id === 'arcade'), 'Enter'));
  await settle();
  assert.doesNotMatch(ui.elements.previewCapabilities.textContent, /Microphone/);
  assert.match(ui.elements.previewCapabilities.textContent, /depend on your browser and device/);
  fire(ui.elements.previewNewTab, 'click');
  assert.equal(ui.opened[0][0], 'https://arcade.freegamestore.online');
});
test('search uses clean game-store links while preserving sibling-store URL conventions', () => {
  for (const [domain, path, suffix] of [['freegamestore.online', 'games', ''], ['freeappstore.online', 'apps', '.html']]) {
    const ui = setup({ query: '?q=chess', crossRegistry: { domain, path, items: [{ id: 'chess', name: 'Chess', description: 'Play chess', category: 'strategy' }] } });
    assert.equal(ui.elements['cross-store-grid'].children[0].href, `https://${domain}/${path}/chess${suffix}`);
  }
});

test('mobile selection opens details while the Play link keeps native navigation', () => {
  const ui = setup({ desktop: false });
  const card = ui.cards[0];
  fire(card, 'click', event(card.querySelector('.app-cta')));
  assert.equal(ui.location.href.includes('/games/'), false);
  fire(card, 'keydown', event(card, ' '));
  assert.equal(ui.location.href, card.dataset.about);
  assert.equal(ui.requests.length, 0);
});
test('nested links and buttons keep their own activation behavior', () => {
  const ui = setup();
  const card = ui.cards[0];
  const link = { closest: (s) => (s.includes('a:not') ? link : null) };
  const e = event(link);
  fire(card, 'click', e);
  fire(card, 'keydown', event(link, 'Enter'));
  assert.equal(e.prevented, false);
  assert.equal(ui.requests.length, 0);
});
test('shrinking a deep-linked preview clears the embed and both URL aliases', async () => {
  const ui = setup({ query: '?app=chess&q=chess' });
  await settle();
  assert.equal(ui.layout.classList.contains('has-preview'), true);
  fire(ui.mq, 'change', { matches: false });
  assert.equal(ui.layout.classList.contains('has-preview'), false);
  const params = new URL(ui.location.href).searchParams;
  assert.equal(params.has('app'), false);
  assert.equal(params.has('game'), false);
  assert.equal(params.get('q'), 'chess');
});
test('a stale iframe load cannot clear the next game loading state', async () => {
  const ui = setup();
  fire(ui.cards[0], 'click', event(ui.cards[0]));
  await settle();
  const oldLoad = ui.frame.handlers.load[0];
  fire(ui.elements.previewClose, 'click');
  fire(ui.cards[1], 'click', event(ui.cards[1]));
  await settle();
  oldLoad();
  assert.equal(ui.elements.previewPane.classList.contains('is-loading'), true);
  fire(ui.frame, 'load');
  assert.equal(ui.elements.previewPane.classList.contains('is-loading'), false);
});


test('isolated selection opens a new tab and cancels an existing embedded preview', async () => {
  const ui = setup({ isolated: ['arcade'] });
  fire(ui.cards.find((c) => c.dataset.id === 'chess'), 'click', event(ui.cards.find((c) => c.dataset.id === 'chess')));
  await settle();
  const selected = ui.cards.find((c) => c.dataset.id === 'arcade');
  const previousRequests = ui.requests.length;
  fire(selected, 'click', event(selected.querySelector('.app-cta')));
  await settle();
  assert.deepEqual(ui.opened[0], ['https://arcade.freegamestore.online', '_blank', 'noopener']);
  assert.equal(ui.requests.length, previousRequests);
  assert.equal(ui.frame.hidden, true);
  assert.equal(ui.elements.previewFullscreen.hidden, true);
  assert.match(ui.elements.previewCapabilities.textContent, /shared memory.*new tab/);
});

test('isolated deep links require an explicit Play action and never fetch an iframe', async () => {
  const ui = setup({ isolated: ['chess'], query: '?game=chess' });
  await settle();
  assert.equal(ui.opened.length, 0);
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.frame.hidden, true);
  assert.equal(ui.elements.previewNewTab.hidden, false);
  fire(ui.elements.previewNewTab, 'click');
  assert.deepEqual(ui.opened[0], ['https://chess.freegamestore.online', '_blank', 'noopener']);
});

test('isolated games open a new tab from keyboard activation on desktop and mobile', () => {
  for (const desktop of [true, false]) {
    const ui = setup({ desktop, isolated: ['chess'] });
    const selected = ui.cards.find((c) => c.dataset.id === 'chess');
    fire(selected, 'keydown', event(selected, 'Enter'));
    assert.deepEqual(ui.opened[0], ['https://chess.freegamestore.online', '_blank', 'noopener']);
    assert.equal(ui.requests.length, 0);
  }
});
