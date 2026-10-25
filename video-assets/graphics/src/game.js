"use strict";
(() => {
  // ../client/src/heraldry.ts
  var GOLD = { lit: "#f3d58a", mid: "#d6a84a", dark: "#a7782a", deep: "#6e4c17" };
  var poly = (pts, fill, extra = "") => `<polygon points="${pts.join(",")}" fill="${fill}"${extra}/>`;
  var mirror = (pts, cx = 100) => pts.map((v, i) => i % 2 ? v : 2 * cx - v);
  function raven() {
    const { lit, mid, dark, deep } = GOLD;
    const wingTop = [88, 62, 70, 48, 52, 32, 34, 18, 18, 14, 26, 30, 46, 46, 64, 62, 86, 74];
    const wingLow = [86, 74, 64, 62, 46, 46, 26, 30, 12, 34, 26, 44, 10, 54, 28, 58, 14, 70, 34, 72, 24, 84, 46, 84, 60, 90, 86, 86];
    const quills = [28, 40, 46, 56, 18, 62, 40, 66, 30, 78, 52, 76];
    const lines = (pts) => {
      let s = "";
      for (let i = 0; i < pts.length; i += 4) s += `<line x1="${pts[i]}" y1="${pts[i + 1]}" x2="${pts[i + 2]}" y2="${pts[i + 3]}" stroke="${deep}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
      return s;
    };
    return [
      poly(wingLow, mid),
      poly(wingTop, lit),
      lines(quills),
      poly(mirror(wingLow), dark),
      poly(mirror(wingTop), mid),
      lines(mirror(quills)),
      // tail: three spread feathers
      poly([92, 116, 100, 122, 100, 160, 84, 152], mid),
      poly([100, 122, 108, 116, 116, 152, 100, 160], dark),
      poly([84, 152, 76, 146, 90, 120, 92, 132], lit),
      poly([116, 152, 124, 146, 110, 120, 108, 132], mid),
      // body: lit on the left, shadowed on the right
      poly([94, 52, 100, 52, 100, 126, 88, 104, 86, 72], lit),
      poly([100, 52, 106, 52, 114, 72, 112, 104, 100, 126], mid),
      poly([90, 82, 100, 92, 110, 82, 100, 104], dark, ' opacity=".35"'),
      // head and beak
      poly([92, 46, 100, 34, 110, 37, 115, 46, 107, 54, 95, 54], lit),
      poly([110, 37, 115, 46, 107, 54], mid),
      poly([113, 43, 132, 48, 113, 51], dark),
      poly([113, 47, 132, 48, 113, 51], deep, ' opacity=".6"'),
      poly([104, 42, 107, 39.5, 110, 42, 107, 44.5], deep),
      // talons
      `<path d="M93 112 l-6 14 m6 -14 l-1 15 M107 112 l6 14 m-6 -14 l1 15" stroke="${dark}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`
    ].join("");
  }
  function sun() {
    const { lit, mid, dark, deep } = GOLD;
    let s = "";
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 - Math.PI / 2, long = i % 2 === 0;
      const r0 = 34, r1 = long ? 86 : 62, half = long ? 0.13 : 0.11;
      const P = (r2, t) => [+(100 + r2 * Math.cos(t)).toFixed(1), +(100 + r2 * Math.sin(t)).toFixed(1)];
      const tip = P(r1, a), l = P(r0, a - half), r = P(r0, a + half), base = P(r0, a);
      const lightSide = Math.cos(a + Math.PI * 0.75) > 0;
      s += poly([...base, ...l, ...tip], lightSide ? lit : mid) + poly([...base, ...r, ...tip], lightSide ? mid : dark);
    }
    const ring = (r) => Array.from({ length: 16 }, (_, k) => {
      const t = k / 16 * Math.PI * 2 - Math.PI / 2;
      return [+(100 + r * Math.cos(t)).toFixed(1), +(100 + r * Math.sin(t)).toFixed(1)];
    });
    const R2 = ring(32);
    for (let k = 0; k < 16; k++) {
      const [a, b] = [R2[k], R2[(k + 1) % 16]];
      const shade = k < 4 || k > 11 ? lit : k < 8 ? mid : k < 12 ? dark : mid;
      s += poly([100, 100, ...a, ...b], shade);
    }
    s += `<polygon points="${ring(24).flat().join(",")}" fill="none" stroke="${deep}" stroke-width="1.6" opacity=".5"/>`;
    const star = Array.from({ length: 16 }, (_, k) => {
      const t = k / 16 * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 7 : 16;
      return [+(100 + r * Math.cos(t)).toFixed(1), +(100 + r * Math.sin(t)).toFixed(1)];
    }).flat();
    return s + poly(star, lit) + `<polygon points="${star.join(",")}" fill="none" stroke="${deep}" stroke-width="1" opacity=".35"/>`;
  }
  function damask(house) {
    const lattice = `<path d="M0 20 L20 0 L40 20 L20 40 Z" fill="none" stroke="#fff" stroke-width=".8"/>`;
    const motif = (x, y) => house === "raven" ? `<path d="M${x - 6} ${y - 1} L${x - 2} ${y - 3} L${x} ${y} L${x + 2} ${y - 3} L${x + 6} ${y - 1} L${x + 2} ${y + 1} L${x} ${y + 4} L${x - 2} ${y + 1} Z" fill="#fff"/>` : `<g transform="translate(${x} ${y})"><path d="M0 -6 L1.5 -1.5 L6 0 L1.5 1.5 L0 6 L-1.5 1.5 L-6 0 L-1.5 -1.5 Z" fill="#fff"/><circle r="1.6" fill="none" stroke="#fff" stroke-width=".7"/></g>`;
    return lattice + motif(20, 20) + motif(0, 0) + motif(40, 0) + motif(0, 40) + motif(40, 40);
  }
  var EMBLEM = { raven: raven(), sun: sun() };
  var DAMASK = { raven: damask("raven"), sun: damask("sun") };

  // ../client/src/banner.ts
  var NS = "http://www.w3.org/2000/svg";
  var uid = 0;
  var COLS = 14;
  var ROWS = 26;
  var L = 20;
  var R = 240;
  var TOP = 126;
  var TEXT_Y = 265;
  var EMBLEM_Y = 440;
  var W = 260;
  var H = 600;
  var LOOKS = {
    raven: { lit: [28, 88, 196], shade: [20, 66, 156], trim: "#f3d58a" },
    // #1c58c4 / #14429c: cool cobalt
    sun: { lit: [200, 36, 36], shade: [154, 24, 28], trim: "#f3d58a" },
    // #c82424 / #9a181c: warm scarlet, well apart from the blue
    frozen: { lit: [143, 176, 204], shade: [106, 143, 176], trim: "#dbe9f4" }
    // #8fb0cc / #6a8fb0
  };
  var el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  function tapestry(svg, overlay, o) {
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let house = o.house, frozen = false, ice = 0;
    const phase = o.phase ?? 0;
    let tails = H - 40, notch = H - 80;
    const fit = () => {
      const { width, height } = svg.getBoundingClientRect();
      const h = width ? Math.max(H, W * height / width) : H;
      svg.setAttribute("viewBox", `0 0 ${W} ${h.toFixed(1)}`);
      tails = h - 40;
      notch = h - 80;
    };
    fit();
    new ResizeObserver(() => {
      fit();
      draw();
    }).observe(svg);
    for (const x of [50, 210]) {
      svg.append(el("line", { x1: x, y1: -800, x2: x, y2: 118, stroke: "#1b1e2c", "stroke-width": 4 }));
      for (let y = -808; y < 112; y += 24) svg.append(el("rect", { x: x - 4, y, width: 8, height: 12, rx: 3, fill: "#2a2f45" }));
    }
    const cloth = el("g", {});
    svg.append(cloth);
    const facets = [];
    for (let k = 0; k < COLS * ROWS; k++) cloth.append(facets[k] = el("polygon", {}));
    const top = el("polygon", { fill: "#000", opacity: 0.3 });
    const trim = el("polyline", { fill: "none", "stroke-width": 1.5, opacity: 0.55 });
    const chevron = el("polygon", { opacity: 0.18 });
    const rim = el("polyline", { fill: "none", stroke: "#ffb02e", "stroke-width": 5, opacity: 0.45 });
    const knot = el("polygon", { opacity: 0.75 });
    const rime = el("polygon", { fill: "#dbe9f4", opacity: 0 });
    const id = `dmk${uid++}`;
    const defs = el("defs", {});
    const pattern = el("pattern", { id, width: 26, height: 26, patternUnits: "userSpaceOnUse" });
    const tile = el("g", { transform: "scale(.65)" });
    pattern.append(tile);
    defs.append(pattern);
    svg.prepend(defs);
    const damask2 = el("polygon", { fill: `url(#${id})`, opacity: 0.1 });
    const emblems = Array.from({ length: 5 }, () => {
      const g = el("g", {}), art = el("g", { transform: "translate(-100 -100)" });
      g.append(art);
      return { g, art };
    });
    const drawHouse = () => {
      tile.innerHTML = DAMASK[house];
      for (const e of emblems) e.art.innerHTML = EMBLEM[house];
    };
    drawHouse();
    cloth.append(damask2, top, chevron, ...emblems.map((e) => e.g), trim, rim, rime, knot);
    svg.append(
      el("rect", { x: 6, y: 116, width: 248, height: 10, fill: "#1b1e2c" }),
      el("rect", { x: 6, y: 116, width: 248, height: 3, fill: "#4a4f68" }),
      el("polygon", { points: "0,121 6,113 12,121 6,129", fill: "#c98a2e" }),
      el("polygon", { points: "248,121 254,113 260,121 254,129", fill: "#c98a2e" })
    );
    const bottom = (u) => tails - (tails - notch) * (1 - Math.abs(2 * u - 1));
    let t = 0, amp = 0;
    const at = (u, v) => {
      const y = TOP + v * (bottom(u) - TOP);
      const hang = v ** 1.35;
      const tt = t + phase;
      const dx = amp * hang * (Math.sin(v * 5.2 - tt * 2.1 + u * 1.3) + 0.35 * Math.sin(v * 9 - tt * 3.3 + u * 2.6));
      return [L + u * (R - L) + dx, y - Math.abs(dx) * 0.12];
    };
    const fold = (u, v) => Math.sin(u * Math.PI * 2.6 - (t + phase) * 1.7 + v * 3.4) * (0.25 + 0.75 * v ** 1.2) * (amp / 8);
    const pts = (list) => list.map(([u, v]) => at(u, v).map((n) => n.toFixed(1)).join(",")).join(" ");
    const mix = (a, b, k) => a.map((n, i) => n + (b[i] - n) * k);
    function draw() {
      const look = LOOKS[house], lit = mix(look.lit, LOOKS.frozen.lit, ice), shade = mix(look.shade, LOOKS.frozen.shade, ice);
      const trimColor = ice > 0.5 ? LOOKS.frozen.trim : look.trim;
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const u0 = i / COLS, u1 = (i + 1) / COLS, v0 = j / ROWS, v1 = (j + 1) / ROWS;
          const a = at(u0, v0), b = at(u1, v0), c = at(u1, v1), d = at(u0, v1);
          const turn = (b[0] - a[0] + (c[0] - d[0])) / 2 / ((R - L) / COLS) - 1 + (d[0] - a[0] + (c[0] - b[0])) / 2 / 30;
          const base = u0 < 0.5 ? lit : shade;
          const k = Math.max(-0.42, Math.min(0.42, turn * 1.1 + fold((u0 + u1) / 2, (v0 + v1) / 2) * 0.34));
          const rgb = base.map((n) => Math.round(k > 0 ? n + (255 - n) * k * 0.35 : n * (1 + k)));
          const f = facets[j * COLS + i];
          f.setAttribute("points", [a, b, c, d].map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" "));
          f.setAttribute("fill", `rgb(${rgb})`);
          f.setAttribute("stroke", `rgb(${rgb})`);
          f.setAttribute("stroke-width", "1");
        }
      }
      const inset = 14 / (R - L);
      top.setAttribute("points", pts([[0, 0], [1, 0], [1, 0.045], [0, 0.045]]));
      trim.setAttribute("points", pts([[inset, 0.045], [inset, 0.95], [0.5, 0.9], [1 - inset, 0.95], [1 - inset, 0.045]]));
      chevron.setAttribute("points", pts([[inset, 0.8], [0.5, 0.73], [1 - inset, 0.8], [1 - inset, 0.83], [0.5, 0.76], [inset, 0.83]]));
      rim.setAttribute("points", pts(Array.from({ length: 12 }, (_, k) => [o.rim === "right" ? 0.99 : 0.01, k / 11])));
      rim.setAttribute("opacity", String(0.45 * (1 - ice)));
      for (const e of [trim]) e.setAttribute("stroke", trimColor);
      for (const e of [chevron, knot]) e.setAttribute("fill", trimColor);
      rime.setAttribute("opacity", String(0.55 * ice));
      damask2.setAttribute("points", pts([...Array.from({ length: 9 }, (_, k) => [0, k / 8]), [0.5, 1], ...Array.from({ length: 9 }, (_, k) => [1, 1 - k / 8])]));
      const span = tails - TOP, last2 = span * 0.74;
      emblems.forEach((e, k) => {
        const y = k === 0 ? Math.min(EMBLEM_Y, TOP + span * 0.69) : EMBLEM_Y + 170 + (k - 1) * 230;
        const v = (y - TOP) / span, show = k === 0 || y + 70 < TOP + last2;
        e.g.style.display = show ? "" : "none";
        if (!show) return;
        const [x] = at(0.5, v), [ax] = at(0.5, Math.max(0, v - 0.05)), [bx] = at(0.5, Math.min(1, v + 0.05));
        e.g.setAttribute("transform", `translate(${x.toFixed(1)} ${(y - Math.abs(x - 130) * 0.12).toFixed(1)}) rotate(${((bx - ax) * 0.5).toFixed(2)}) scale(${k ? 0.5 : 0.98})`);
        e.g.setAttribute("opacity", String((k ? 0.55 : 0.95) - 0.4 * ice));
      });
      rime.setAttribute("points", pts([[0, 0.86], [0.25, 0.9], [0.5, 0.82], [0.75, 0.9], [1, 0.86], [1, 1], [0.5, 1], [0, 1]]));
      const [kx, ky] = at(0.5, 0.86);
      knot.setAttribute("points", `${kx},${ky - 7} ${kx + 5},${ky} ${kx},${ky + 7} ${kx - 5},${ky}`);
      const vt = (TEXT_Y - TOP) / (bottom(0.5) - TOP);
      const [ox] = at(0.5, vt), [ox2] = at(0.5, vt + 0.1 * (H - 40 - TOP) / (bottom(0.5) - TOP));
      overlay.style.transform = `translateX(${((ox - 130) / 260 * 100).toFixed(2)}cqw) rotate(${((ox2 - ox) * 0.4).toFixed(2)}deg)`;
    }
    let last = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (svg.closest("[hidden]")) return void (last = 0);
      const dt = last ? Math.min(0.05, (now - last) / 1e3) : 0;
      last = now;
      if (still.matches) {
        if (amp) {
          amp = 0;
          draw();
        }
        return;
      }
      t += dt;
      ice += ((frozen ? 1 : 0) - ice) * Math.min(1, dt * 1.5);
      const gust = Math.max(0, Math.sin(t * 0.37)) ** 4 + 0.5 * Math.max(0, Math.sin(t * 0.83 + 1)) ** 6;
      amp = (5 + gust * 7) * (1 - ice * 0.2);
      draw();
    }
    draw();
    requestAnimationFrame(frame);
    return {
      set(next) {
        if (next.house && next.house !== house) {
          house = next.house;
          drawHouse();
        }
        if (next.frozen !== void 0) {
          frozen = next.frozen;
          if (still.matches) ice = frozen ? 1 : 0;
        }
        draw();
      }
    };
  }

  // graphics/src/game-entry.ts
  window.Game = { tapestry, EMBLEM, DAMASK };
})();
