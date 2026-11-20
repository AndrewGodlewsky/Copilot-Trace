// Parse number tokens and object members directly: JSON.parse would round large numbers and lose duplicate keys.
export function readableEvent(source) {
  if (typeof source !== 'string' || source.length > 12000) return null;
  let offset = 0, nodes = 0;
  const space = () => { while (offset < source.length && /[ \t\r\n]/.test(source[offset])) offset++; };
  function string() {
    const start = offset++;
    while (offset < source.length) {
      const next = source[offset++];
      if (next === '\\') offset++;
      else if (next === '"') return JSON.parse(source.slice(start, offset));
    }
    throw Error();
  }
  function value(key, depth) {
    if (++nodes > 400 || depth > 12) throw Error();
    space(); const char = source[offset];
    if (char === '{' || char === '[') {
      offset++; space();
      const end = char === '{' ? '}' : ']', children = [];
      if (source[offset] !== end) for (;;) {
        space(); let childKey = String(children.length);
        if (char === '{') {
          if (source[offset] !== '"') throw Error();
          childKey = string(); space(); if (source[offset++] !== ':') throw Error();
        }
        children.push(value(childKey, depth + 1)); space();
        if (source[offset] !== ',') break;
        offset++;
      }
      if (source[offset++] !== end) throw Error();
      return { key, type: char === '{' ? 'object' : 'array', children };
    }
    if (char === '"') return { key, type: 'string', value: string() };
    const token = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset))?.[0];
    if (!token) throw Error(); offset += token.length;
    return { key, type: token === 'null' ? 'null' : ['true', 'false'].includes(token) ? 'boolean' : 'number', value: token };
  }
  try { const result = value('Event', 0); space(); return offset === source.length ? result : null; } catch { return null; }
}

export function createEventData(document, entry) {
  const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const view = element('details'); view.className = 'event-data';
  view.append(element('summary', 'Readable event fields'));
  const body = element('div'); view.append(body);
  let source, clipped, rendered = false;
  function field(value) {
    if (value.children) {
      const group = element('details'), nested = element('div'); group.className = 'event-data-group';
      group.append(element('summary', `${value.key} · ${value.type} · ${value.children.length} fields`), nested);
      let loaded = false;
      group.addEventListener('toggle', () => { if (group.open && !loaded) { loaded = true; for (const child of value.children) nested.append(field(child)); } });
      return group;
    }
    const row = element('div'); row.className = 'event-data-field';
    const text = element('pre', value.value); text.tabIndex = 0;
    row.append(element('strong', `${value.key} · ${value.type}`), text); return row;
  }
  function render() {
    if (!view.open || rendered) return;
    rendered = true; body.replaceChildren();
    const parsed = !clipped && readableEvent(source);
    if (!parsed) body.append(element('p', 'Readable fields unavailable: the source is clipped, malformed or exceeds the 12-level / 400-field display limit. Use Original JSON.'));
    else {
      body.append(element('p', 'Strings show their actual line breaks. Field order, duplicate keys and number text are preserved. Original JSON is below.'));
      for (const child of parsed.children ?? [parsed]) body.append(field(child));
    }
  }
  view.addEventListener('toggle', render);
  function update(next) { if (source !== next.evidence || clipped !== next.truncated) { source = next.evidence; clipped = next.truncated; rendered = false; body.replaceChildren(); render(); } }
  update(entry); return { view, update };
}
