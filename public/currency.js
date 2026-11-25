const $ = (id) => document.getElementById(id);
const STORAGE = { base:'currency-base', to: 'currency-to', favs:'currency-favourites' };


function store(op, key, value) {
    try {
        if (op === 'get')
            return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch (e) {}
    return null;
}

function loadFavs() {
    try {
        return new Set(JSON.parse(store('get', STORAGE.favs) || '[]'));
    } catch (e) {
        return new Set();
    }
}

let state = {
    base: store('get', STORAGE.base) || 'USD',
    target: store('get', STORAGE.to) ||'EUR',
    rates: null,
    updated: null,
    stale: false,
    favs: loadFavs(),
    codesLoaded: false,
};

let requestId = 0;

let nameFormatter = null;
try { 
    nameFormatter = new Intl.DisplayNames(['en'], {type:'currency'}); 
} catch (e) {}

function currencyName(code) {
    try { 
        return (nameFormatter && nameFormatter.of(code)) || code;
    } catch (e) {return code; }
}

async function api(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
        res = await fetch(path, {signal: controller.signal});
    } catch (e) {
        throw new Error(e.name === 'AbortError'
            ? 'The server took too long to respond. Please try again.'
            : 'Cannot reach the server. Check your connection.'
        );
    } finally {
        clearTimeout(timer);
    }
    let body = null;
    try {body = await res.json();} catch (e) {}
    if (!res.ok) throw new Error((body && body.error) || `Request failed(${res.status}).`);
    return body;
}

async function loadRates() {
    const id = ++requestId;
    showMessage('Loading exchange rates...');
    try {
        const data = await api(`/api/rates?base=${encodeURIComponent(state.base)}`);
        if (id !== requestId) return;
        state.rates = data.rates;
        state.updated = data.updated;
        state.stale = Boolean(data.stale);
        if (!state.codesLoaded) fillCurrencySelects(Object.keys(data.rates));
        if (!Number.isFinite(data.rates[state.target])) state.target = pickDefaultTarget(data.rates);
        $('base').value = state.base;
        $('to').value = state.target;
        $('base-label').textContent = state.base;
        $('status').textContent = state.updated ? `Rates last updated: ${state.updated}` : '';
        if (data.stale) {
        showMessage('The live rate service is unavailable, so these are the last saved rates.', false, true);
    } else {
        showMessage('');
    } if (!$('result').hidden) convert();
    } catch (err) {
        if (id !== requestId) return;
        state.rates = null;
        hideResult();
        showMessage(err.message, true, true);
    }
    render();
}

function fillCurrencySelects(codes) {
    const sorted = codes.slice().sort();
    for (const id of ['base', 'to']){
        const select = $(id);
    select.replaceChildren();
    for (const code of sorted) {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = `${code} - ${currencyName(code)}`;
        select.appendChild(o);
    }
}
    state.codesLoaded = true;
}

function pickDefaultTarget(rates) {
    for (const code of ['EUR', 'USD', 'GBP']) {
        if (code !==state.base && Number.isFinite(rates[code])) return code;
    }
    return Object.keys(rates).find((code) => code !==state.base) || state.base;
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function showMessage(text, isError = false, withRetry = false) {
    const box = $('message');
    box.replaceChildren();
    box.className = 'message' + (isError ? ' error' : '');
    box.hidden = !text;
    if (!text) return;
    box.appendChild(document.createTextNode(text));
    if (withRetry) {
        const b = el('button', '', 'Retry');
        b.type = 'button';
        b.addEventListener('click', loadRates);
        box.appendChild(b);
    }
}

function fmt(n) {
    if (!Number.isFinite(n)) return '-';
    const opts = n >= 1 ? {maximumFractionDigits: 2} : {maximumSignificantDigits: 4};
    return n.toLocaleString(undefined, opts);
}

function saveFavs() {store('set', STORAGE.favs, JSON.stringify([...state.favs]));}

function hideResult() {
    $('result').hidden = true;
}

async function convert() {
    if (!state.rates) {
        await loadRates();
        if (!state.rates) return;
    }

    const amount = parseFloat($('amount').value);
    if (!Number.isFinite(amount) || amount < 0) {
        hideResult();
        showMessage('Enter a valid amount.', true);
        return;
    }

    const rate = state.rates[state.target];
    if (!Number.isFinite(rate) || rate <= 0) {
        hideResult();
        showMessage(`No rate is available for ${state.target}.`, true);
        return;
    }
    if ($('message').textContent.startsWith('Enter a valid')) showMessage('');

    const shownAmount = amount.toLocaleString(undefined, {maximumFractionDigits: 6});
    $('result-main').textContent = `${shownAmount} ${state.base} = ${fmt(amount * rate)} ${state.target}`;

    let details = `1 ${state.base} = ${fmt(rate)} ${state.target} (${currencyName(state.target)})`;
    details += `\u00b7 1 ${state.target} = ${fmt(1 / rate)} ${state.base}`;
    if (state.stale) details +=' \u00b7 saved rates';
    $('result-sub').textContent = details;
    $('result').hidden = false;
}

async function swap() {
    if (!state.rates)
        return;
    const oldBase = state.base;
    state.base = state.target;
    state.target = oldBase;
    store('set', STORAGE.base, state.base);
    store('set', STORAGE.to, state.target);
        $('base').value = state.base;
        $('to').value = state.target;
        hideResult();
        await loadRates();
        if (state.rates) convert();
}

function visibleRows() {
    const q = $('search').value.trim().toLowerCase();
    const favOnly = $('fav-only').checked;
    const sort = $('sort').value;

    const rows = Object.entries(state.rates)
    .filter(([code]) => code !== state.base)
    .map(([code, rate]) => ({code, rate, name: currencyName(code)}))
    .filter((r) => {
        if (favOnly && !state.favs.has(r.code)) return false;
        if (q && !(r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))) return false;
        return true;
    });

    rows.sort((a, b) => {
        switch (sort) {
            case 'name': return a.name.localeCompare(b.name);
            case 'rate-desc': return b.rate - a.rate;
            case 'rate-asc': return a.rate - b.rate;
            default: return a.code.localeCompare(b.code);
        }
    });
    return rows;
}

function render() {
    const tbody = $('rows');
    tbody.replaceChildren();
    if (!state.rates) return;

    const amount = parseFloat($('amount').value);
    if (!Number.isFinite(amount) || amount < 0) {
        showMessage('Enter a valid amount', true);
    }
    else if ($('message').className.includes('error') && $('message').textContent.startsWith('Enter a valid')) {
        showMessage('');
    }

    const rows = visibleRows();
    if (!rows.length) {
        const tr = el('tr');
        const td = el('td', '', $('fav-only').checked && !state.favs.size
    ? 'No favourites yet. Click the star next to currency to add one.'
    : 'No currencies match your search.');
    td.colSpan = 5;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
    }

    for (const r of rows) {
        const isFav = state.favs.has(r.code);
        const tr = el('tr');
        const starCell = el('td', 'star-col');
        const star = el('button', 'star' + (isFav ? ' on' : ''), isFav ? '\u2605' :'\u2606');
        star.type = 'button';
        star.setAttribute('aria-label', `${isFav ? 'Remove' : 'Add'} ${r.code} ${isFav ? 'from' : 'to'} favourites`);
        star.addEventListener('click', () => {
            isFav ? state.favs.delete(r.code) : state.favs.add(r.code);
            saveFavs();
            render();
        });

        starCell.appendChild(star);
        tr.appendChild(starCell);
        tr.appendChild(el('td', 'code', r.code));
        tr.appendChild(el('td', '', r.name));
        tr.appendChild(el('td', 'num', fmt(r.rate)));
        tr.appendChild(el('td', 'num', Number.isFinite(amount) && amount >= 0 ? fmt(amount * r.rate) : '-'));
        tbody.appendChild(tr);
    }
}

$('convert-form').addEventListener('submit', (e) => {
    e.preventDefault();
    convert();
});

$('base').addEventListener('change', () => {
    state.base = $('base').value;
    store('set', STORAGE.base, state.base);
    hideResult();
    loadRates();
});

$('to').addEventListener('change', () => {
    state.target = $('to').value;
    store('set', STORAGE.to, state.target);
    hideResult();
});

$('swap').addEventListener('click', swap);

$('refresh').addEventListener('click', loadRates);

$('amount').addEventListener('input', () => {
    hideResult();
    render();
});
for (const id of ['search', 'sort','fav-only']) $(id).addEventListener('input', render);

function showSavedChoice(id, code) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = code;
    $(id).replaceChildren(o);
}
showSavedChoice('base', state.base);
showSavedChoice('to', state.target);
$('base-label').textContent = state.base;

loadRates();
api('/api/server').then((s) => { $('served-by').textContent = `Served by: ${s.server}`;}).catch(() => {});