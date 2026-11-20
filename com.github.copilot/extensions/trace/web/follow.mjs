function liveAppend(snapshot, previous) {
  if (!previous || previous.history !== 'ready' || snapshot.history !== 'ready'
    || !Number.isSafeInteger(previous.liveReceipt) || !Number.isSafeInteger(snapshot.liveReceipt)) return;
  const dropped = snapshot.omitted - previous.omitted;
  if (!Number.isSafeInteger(dropped) || dropped < 0 || (dropped && dropped >= previous.entries.length)) return;
  const retained = previous.entries.slice(dropped);
  if (snapshot.entries.length <= retained.length
    || !retained.every((entry, index) => JSON.stringify(entry) === JSON.stringify(snapshot.entries[index]))) return;
  if (snapshot.entries.slice(retained.length).every(entry => entry.observation?.source === 'live'
    && Number.isSafeInteger(entry.observation.receipt) && entry.observation.receipt > previous.liveReceipt
    && entry.observation.receipt <= snapshot.liveReceipt)) return dropped;
}

export function createLivePresentation({ render, following, canAnimate,
  now = () => performance.now(), requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id) }) {
  let batch, frame, closed = false;
  function cancel() {
    const snapshot = batch?.latest;
    batch = undefined;
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
    following.stop();
    return snapshot;
  }
  function finish() {
    const current = batch, snapshot = cancel();
    if (!snapshot) return;
    if (current.shown !== snapshot) render(snapshot);
    following.sync();
  }
  function reveal(time) {
    const phase = Math.min(4, 1 + Math.floor((time - batch.start) / 60));
    const count = Math.max(batch.count, batch.base + Math.ceil((batch.latest.entries.length - batch.base) * phase / 4));
    if (count === batch.count && batch.source === batch.latest) return;
    batch.count = count; batch.source = batch.latest;
    batch.shown = count === batch.latest.entries.length ? batch.latest : { ...batch.latest, entries: batch.latest.entries.slice(0, count) };
    render(batch.shown);
  }
  function tick(current) {
    if (batch !== current || closed) return;
    frame = undefined;
    following.onScroll();
    if (!canAnimate()) { finish(); return; }
    reveal(now());
    const time = now();
    // Spend one shared deadline, including rendering time; never queue a delay per event.
    following.advance(Math.min(1, (time - batch.last) / (batch.start + 240 - batch.last)));
    batch.last = time;
    if (time >= batch.start + 240) finish();
    else frame = requestFrame(() => tick(current));
  }
  return {
    present(snapshot, previous) {
      if (closed) return;
      following.onScroll();
      const dropped = liveAppend(snapshot, previous);
      if (!canAnimate() || dropped === undefined) {
        cancel(); render(snapshot); following.sync(); return;
      }
      if (!batch) {
        const time = now();
        batch = { base: previous.entries.length, count: previous.entries.length, start: time, last: time };
        following.start();
      }
      batch.base = Math.max(0, batch.base - dropped);
      batch.count = Math.max(0, batch.count - dropped);
      batch.latest = snapshot;
      reveal(now());
      if (now() >= batch.start + 240) finish();
      else if (frame === undefined) { const current = batch; frame = requestFrame(() => tick(current)); }
    },
    finish,
    cancel,
    close() { closed = true; cancel(); },
  };
}

export function createFollow(checkbox, getPage) {
  let previousTop = getPage()?.scrollTop ?? 0;
  let animating = false;
  function onScroll() {
    const page = getPage();
    if (!page) return;
    const awayFromBottom = page.scrollHeight - page.clientHeight - page.scrollTop > 2;
    if (checkbox.checked && awayFromBottom && page.scrollTop < previousTop) checkbox.checked = false;
    if (!checkbox.checked) animating = false;
    previousTop = page.scrollTop;
  }
  function sync() {
    // A poll/resize may run before the browser dispatches the user's scroll event.
    onScroll();
    const page = getPage();
    if (checkbox.checked && page && !animating) {
      page.scrollTop = page.scrollHeight;
      previousTop = page.scrollTop;
    }
  }
  return {
    sync,
    onScroll,
    start() { onScroll(); animating = checkbox.checked; },
    stop() { animating = false; },
    advance(fraction) {
      onScroll();
      const page = getPage();
      if (!checkbox.checked || !page || !animating) return;
      const bottom = Math.max(0, page.scrollHeight - page.clientHeight);
      page.scrollTop += (bottom - page.scrollTop) * fraction;
      previousTop = page.scrollTop;
    },
    onChange() {
      previousTop = getPage()?.scrollTop ?? 0;
      sync();
    },
  };
}
