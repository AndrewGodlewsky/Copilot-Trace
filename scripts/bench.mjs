// Reproducible scale measurements on seeded synthetic data. No real session, network or model is used.
// Usage: npm run bench [-- --sizes 1000,10000,100000]
import { performance } from 'node:perf_hooks';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { makeSession, persisted, host } from '../test/fixtures/workload.mjs';

const flag = process.argv.indexOf('--sizes');
const sizes = flag > 0 ? process.argv[flag + 1].split(',').map(Number) : [1000, 10000, 30000, 100000];
const ms = value => `${value.toFixed(1)} ms`;
const mb = value => `${(value / 1e6).toFixed(1)} MB`;

console.log('History hydration and polling (retained window: 300 events)');
for (const size of sizes) {
  const history = persisted(makeSession(size));
  let bytes = 0;
  for (const event of history) bytes += JSON.stringify(event).length;
  const fixture = host(history);
  let start = performance.now();
  const trace = createTrace(fixture.session);
  await trace.ready;
  const hydrate = performance.now() - start;
  start = performance.now();
  for (let i = 0; i < 1000; i++) trace.snapshot();
  const poll = (performance.now() - start) / 1000;
  const body = JSON.stringify(trace.snapshot());
  const live = makeSession(2000, { seed: 99, start: Date.parse(history.at(-1).timestamp) + 1000 });
  start = performance.now();
  for (const event of live) fixture.emit(event);
  const perLive = (performance.now() - start) / live.length;
  console.log(`  ${String(history.length).padStart(7)} events (${mb(bytes).padStart(9)} history): hydrate ${ms(hydrate).padStart(9)} · unchanged poll ${poll.toFixed(3)} ms · snapshot ${(body.length / 1024).toFixed(0)} KB · live event ${perLive.toFixed(3)} ms`);
  trace.close();
}

async function window(size) {
  const all = makeSession(Math.ceil(size * 1.15), { seed: 13, largeResults: false });
  const entries = [];
  for (let offset = 0; entries.length < size && offset < all.length; offset += 300) {
    const trace = createTrace(host(persisted(all.slice(offset, offset + 300))).session);
    await trace.ready;
    entries.push(...trace.snapshot().entries);
    trace.close();
  }
  return { history: 'ready', omitted: 0, entries: entries.slice(0, size) };
}
const analyses = {
  turnContext: s => presentation.turnContext(s.entries, s), actionStages: s => presentation.actionStages(s.entries, s),
  recoveryAttempts: s => presentation.recoveryAttempts(s.entries, s), toolProvenance: s => presentation.toolProvenance(s.entries),
  toolOperations: s => presentation.toolOperations(s.entries), toolOutcomes: s => presentation.toolOutcomes(s.entries),
  toolExtents: s => presentation.toolExtents(s.entries, s), validationClaims: s => presentation.validationClaims(s.entries, s),
  compactionAttempts: s => presentation.compactionAttempts(s.entries), delegationHandoffs: s => presentation.delegationHandoffs(s.entries, s),
  hookInvocations: s => presentation.hookInvocations(s.entries), summarize: s => presentation.summarize(s.entries),
  groupSteps: s => presentation.groupSteps(s.entries), requestChapters: s => presentation.requestChapters(s.entries, s),
  agentLanes: s => presentation.agentLanes(s.entries, s), retrievalLedger: s => presentation.retrievalLedger(s.entries, s),
  validationOverview: s => presentation.validationOverview(s.entries, s), repeatedActivity: s => presentation.repeatedActivity(s.entries, s),
  observedActivity: s => presentation.observedActivity(s.entries, { ...s, now: Date.now() }),
  observedTimeAndUsage: s => presentation.observedTimeAndUsage(s.entries, s), observedRecap: s => presentation.observedRecap(s.entries, s),
};
console.log('\nPanel analyses on one fresh snapshot (cold evidence cache)');
const windows = [300, 3000, 30000];
const results = {};
for (const size of windows) {
  const source = JSON.stringify(await window(size));
  for (const [name, run] of Object.entries(analyses)) {
    let best = Infinity;
    for (let i = 0; i < (size > 3000 ? 2 : 5); i++) {
      const snapshot = JSON.parse(source);
      const start = performance.now(); run(snapshot); best = Math.min(best, performance.now() - start);
    }
    (results[name] ??= []).push(best);
  }
}
console.log(`  ${'analysis'.padEnd(22)}${windows.map(size => `${size} records`.padStart(16)).join('')}`);
for (const [name, times] of Object.entries(results)) console.log(`  ${name.padEnd(22)}${times.map(value => ms(value).padStart(16)).join('')}`);
const totals = windows.map((_, i) => Object.values(results).reduce((sum, times) => sum + times[i], 0));
console.log(`  ${'TOTAL'.padEnd(22)}${totals.map(value => ms(value).padStart(16)).join('')}`);

// The analyses one panel render runs on a shared snapshot (warm evidence cache), with the Statistics drawer share.
console.log('\nOne render on a 300-record snapshot (shared evidence cache)');
{
  const source = JSON.stringify(await window(300));
  const render = (s, statistics) => {
    const { entries } = s;
    if (statistics) {
      presentation.retrievalLedger(entries, s); presentation.validationOverview(entries, s);
      presentation.observedActivity(entries, { ...s, now: Date.now() }); presentation.repeatedActivity(entries, s); presentation.summarize(entries);
      return;
    }
    const contexts = presentation.turnContext(entries, s), stages = presentation.actionStages(entries, s);
    presentation.recoveryAttempts(entries, s, stages); presentation.toolProvenance(entries);
    const operations = presentation.toolOperations(entries), outcomes = presentation.toolOutcomes(entries);
    presentation.toolExtents(entries, s); presentation.validationClaims(entries, s); presentation.validationChecks(entries);
    presentation.compactionAttempts(entries); presentation.delegationHandoffs(entries, s); presentation.hookInvocations(entries);
    for (const entry of entries) { presentation.describeTurn(entry, contexts.get(entry.id), operations.get(entry.id)); presentation.explainStep(entry, outcomes.get(entry.id)); }
    presentation.groupSteps(entries); presentation.groupSteps(entries, true); presentation.requestChapters(entries, s); presentation.agentLanes(entries, s);
    render(s, true);
  };
  const measure = statistics => {
    const snapshot = JSON.parse(source); render(snapshot); // warm this snapshot's evidence cache, as earlier passes do
    let best = Infinity;
    for (let i = 0; i < 50; i++) { const start = performance.now(); render(snapshot, statistics); best = Math.min(best, performance.now() - start); }
    return best;
  };
  const cold = () => { let best = Infinity; for (let i = 0; i < 20; i++) { const snapshot = JSON.parse(source), start = performance.now(); render(snapshot); best = Math.min(best, performance.now() - start); } return best; };
  console.log(`  first render of a new snapshot ${ms(cold())} · repeated render ${ms(measure(false))} · Statistics drawer reports ${ms(measure(true))}`);
}

// Decision 1: what receiving the whole history as one RPC result costs the extension, versus a 400-event tail page.
console.log('\nReceiving history (extension-side JSON parse only; runtime-side work is not measurable here)');
for (const size of sizes.filter(size => size >= 10000)) {
  const history = persisted(makeSession(size));
  const whole = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { events: history } });
  const tail = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { events: history.slice(-400) } });
  globalThis.gc?.(); const heap = process.memoryUsage().heapUsed;
  let start = performance.now();
  const parsed = JSON.parse(whole);
  const wholeTime = performance.now() - start; globalThis.gc?.(); const wholeHeap = process.memoryUsage().heapUsed - heap;
  start = performance.now(); JSON.parse(tail);
  console.log(`  ${String(history.length).padStart(7)} events: whole history ${mb(whole.length)} parsed in ${ms(wholeTime)}${globalThis.gc ? ` (+${mb(wholeHeap)} retained heap)` : ""} · 400-event tail ${mb(tail.length)} in ${ms(performance.now() - start)}`);
  void parsed;
}

// Decision 3: full renders per changed live poll with the stepped reveal (16 ms frames, polls 1 s apart).
console.log('\nLive reveal');
{
  const { createLivePresentation } = await import('../com.github.copilot/extensions/trace/web/follow.mjs');
  const all = makeSession(1600, { seed: 5 }), fixture = host(persisted(all.slice(0, 1000)));
  const trace = createTrace(fixture.session); await trace.ready;
  const polls = [];
  all.slice(1000).forEach((event, index) => { fixture.emit(event); if (index % 3 === 0) polls.push(JSON.parse(JSON.stringify(trace.snapshot()))); });
  trace.close();
  let clock = 0, renders = 0;
  const frames = [];
  const live = createLivePresentation({ render() { renders++; }, canAnimate: () => true, now: () => clock,
    following: { onScroll() {}, sync() {}, start() {}, stop() {}, advance() {} },
    requestFrame: callback => frames.push(callback), cancelFrame() {} });
  for (let i = 1; i < polls.length; i++) {
    live.present(polls[i], polls[i - 1]);
    while (frames.length) { clock += 16; frames.shift()(); }
    clock += 1000;
  }
  console.log(`  ${(renders / (polls.length - 1)).toFixed(2)} full renders per changed poll while following (1.00 without the stepped reveal)`);
}
