// A virtual clock for rendering the game frame by frame (film.mjs, drone.mjs): installed in the page
// before anything runs, it holds timers, animation frames and CSS / Web Animations still until
// window.__advance(ms) moves them on, so every frame is exact however slowly it's captured.
export const CLOCK = () => {
  let now = 0, id = 1;
  const t0 = Date.now(), raf = new Map(), timers = new Map();
  performance.now = () => now;
  Date.now = () => t0 + now;
  window.requestAnimationFrame = (f) => (raf.set(id, f), id++);
  window.cancelAnimationFrame = (i) => raf.delete(i);
  window.setTimeout = (f, ms = 0, ...a) => (timers.set(id, { at: now + Math.max(0, +ms || 0), f, a }), id++);
  window.setInterval = (f, ms = 0, ...a) => (timers.set(id, { at: now + Math.max(1, +ms || 0), f, a, every: Math.max(1, +ms || 0) }), id++);
  window.clearTimeout = window.clearInterval = (i) => timers.delete(i);
  const call = (f, a) => { try { typeof f === 'function' ? f(...a) : (0, eval)(f); } catch (e) { console.error(e); } };
  window.__advance = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [k, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [k, t];
      if (!next) break;
      const [k, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else timers.delete(k);
      call(t.f, t.a);
    }
    now = end;
    const frames = [...raf.values()];
    raf.clear();
    for (const f of frames) call(f, [now]);
    // CSS animations and transitions: held, and moved on by hand to this clock.
    for (const a of document.getAnimations()) {
      try {
        if (a.__t0 === undefined) { a.__t0 = now - (a.currentTime ?? 0); a.pause(); }
        a.currentTime = now - a.__t0;
        const end = a.effect?.getComputedTiming().endTime;
        if (Number.isFinite(end) && a.currentTime >= end) a.finish();
      } catch { /* an infinite animation can't finish */ }
    }
    return now;
  };
};
