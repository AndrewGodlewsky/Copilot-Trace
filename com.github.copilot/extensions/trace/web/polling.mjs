export function createPoller({ load, onError = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
  let pending;
  let timer;
  let stopped = false;
  function refresh() {
    cancel(timer);
    if (stopped) return Promise.resolve(false);
    if (pending) return pending;
    pending = (async () => {
      await Promise.resolve();
      try { return await load(); }
      catch { onError(); return false; }
      finally {
        pending = undefined;
        if (!stopped) timer = schedule(() => { void refresh(); }, 1000);
      }
    })();
    return pending;
  }
  return { refresh, stop() { stopped = true; cancel(timer); } };
}
