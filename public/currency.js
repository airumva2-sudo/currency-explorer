const $ = (id) => document.getElementById(id);
const STORAGE = { base:'currency-base', favs:'currency-favourites' };

let state = {
    base: store('get', STORAGE.base) || 'USD',
    rates: null,
    updated: null,
    favs: new Set(JSON.parse(store('get', STORAGE.favs) || '[]')),
    codesLoaded: false,
};

function store(op, key, value) {
    try {
        if (op === 'get')
            return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch (e) {}
    return null;
}

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
    let res;
    try {res = await fetch(path);}
    catch (e) {throw new Error('Cannot reach the server. Check your connection.');}
    let body = null;
    try {body = await res.json();} catch (e) {}
    if (!res.ok) throw new Error((body && body.error) || `Request failed(${res.status}).`);
    return body;
}

async function loadRates() {
    showMessage('Loading exhange rates..');
    try {
        const data = await api(`/api/rates?base=${encodeURIComponent(state.base)}`);
        state.rates = data.rates;
        state.updated = data.updated;
        if (!state.codesLoaded) fillBaseSelect(Object.keys(data.rates));
        $('base').value = state.base;
        $('base-label').textContent = state.base;
        $('status').textContent = state.updated ? `Rates last updated: ${state.updated}` : '';
        showMessage('');
    } catch (err) {
        state.rates = null;
        showMessage(err.message, true, true);
    }
    render();
}

function fillBaseSelect(codes) {
    const select = $('base');
    select.replaceChildren();
    for (const code of codes.sort()) {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = `${code} - ${currencyName(code)}`;
        select.appendChild(o);
    }
    state.codesLoaded = true;
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
    const opts = n >= 1 ? {maximunFractionDigits: 2} : {maximumSignificantDigits: 4};
    return n.toLocaleString(undefined, opts);
}

function saveFavs() {store('set', STORAGE.favs, JSON.stringify([...state.favs]));}

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
    ? 'No favourites yet.Click the star next to currency to add one.'
    : 'No currencies match your search.');
    td.colSpan = 5;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
    }

    for (const r of rows) {
        const tr = el('tr');
        const starCell = el('td', 'star-col');
        const star = el('button', 'star' + (state.favs.has(r.code) ? ' on' : ''), state.favs.has(r.code) ? '' :'');
        star.type = 'button';
        star.setAttribute('aria-label', `${state.favs.has(r.code) ? 'Remove' : 'Add'} ${r.code} ${state.favs.has(r.code) ? 'from' : 'to'} favourites`);
        star.addEventListener('click', () => {
            state.favs.has(r.code) ? state.favs.delete(r.code) : state.favs.add(r.code);
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

$('base').addEventListener('change', () => {
    state.base = $('base').value;
    store('set', STORAGE.base, state.base);
    loadRates();
});

$('refresh').addEventListener('click', loadRates);
for (const id of ['amount', 'search', 'sort','fav-only']) $(id).addEventListener('input', render);

loadRates();
api('/api/server').then((s) => { $('served-by').textContent = `Served by: ${s.server}`;}).catch(() => {});