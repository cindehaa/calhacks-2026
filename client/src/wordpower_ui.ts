// Word power on the client: picks the mode (?power=slow&score=features, or P / Shift+P in game),
// shows a live meter above the elixir bar while you talk or type, and gates your own drops on
// the recharge. The rules themselves are in shared/wordpower.ts.
import { MIN_DEPLOY_DELAY } from '../../shared/arena';
import { ART_MAX, PRESETS, RULES, budgetFor, decodeMode, encodeMode, quote, usesPower, MAX_DETAIL, PLAIN_BUDGET, type PowerMode } from '../../shared/wordpower';
import type { MatchSource } from './match';

const STORE = 'wordpower';

function initialMode(): PowerMode {
  const q = new URLSearchParams(location.search);
  if (q.has('power') || q.has('score')) return decodeMode(`${q.get('power') ?? 'cooldown'}.${q.get('score') ?? 'words'}`, 'cooldown');
  try { return decodeMode(localStorage.getItem(STORE), 'cooldown'); } catch { return decodeMode('', 'cooldown'); }
}

const CSS = `
#wordMeter { font-size: 12px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
#wordMeter[hidden] { display: none; }
#wordMeter .wmHead { display: flex; justify-content: space-between; gap: 8px; }
#wordMeter .wmHead b { color: var(--text); }
#wordMeter .wmBar { position: relative; height: 14px; border-radius: 7px; background: rgba(23, 27, 46, 0.25); border: 1px solid var(--line); overflow: hidden; }
#wordMeter .wmFill { position: absolute; inset: 0 auto 0 0; width: 0; background: linear-gradient(90deg, #6bc6ff, #b77bff 60%, #ff5d7a); transition: width .15s ease-out; }
#wordMeter .wmWait { position: absolute; inset: 0 auto 0 0; width: 0; background: rgba(255, 255, 255, 0.28); }
#wordMeter .wmPlain { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255, 255, 255, 0.6); }
#wordMeter .wmText { position: relative; display: block; text-align: center; font-weight: 700; line-height: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 6px; }
#wordMeter.pulse .wmBar { animation: wmPulse .25s ease-out; }
#wordMeter.op .wmText { color: #ffd34d; }
@keyframes wmPulse { from { transform: scaleY(1.5); } to { transform: scaleY(1); } }
body.wp-noelixir #elixir { display: none; }
`;

export interface WordPowerUi {
  mode(): PowerMode;
  gate(): string | null; // why you can't lock right now, or null
  live(words: string): void; // words heard (or typed) so far
  deployed(description: string): void; // the match took it; the voice lock starts
  artHoldMs(releasedAt: number | undefined): number; // how long to hold a deploy for its art (art preset), from performance.now()
  cost(description: string, elixirCost: number): number; // what the cost pill will say
  frame(m: MatchSource | null): void;
}

export function initWordPower(status: (msg: string, bad?: boolean) => void): WordPowerUi {
  let mode = initialMode();
  let words = '';
  let lastDetail = 0;
  let readyAt = 0; // performance.now() ms when you may lock again
  let elixir = Infinity;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement('div');
  el.id = 'wordMeter';
  el.innerHTML = `<div class="wmHead"><span class="wmMode"></span><span class="wmHint">P: switch · Shift+P: scoring</span></div>
    <div class="wmBar"><div class="wmFill"></div><div class="wmWait"></div><div class="wmPlain"></div><span class="wmText"></span></div>`;
  const dock = document.getElementById('dock')!;
  dock.prepend(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  q('.wmPlain').style.left = `${(PLAIN_BUDGET / budgetFor(MAX_DETAIL)) * 100}%`;

  const desc = document.getElementById('descInput') as HTMLInputElement | null;
  desc?.addEventListener('input', () => api.live(desc.value));

  function setMode(m: PowerMode) {
    mode = m;
    try { localStorage.setItem(STORE, encodeMode(m)); } catch { /* storage blocked */ }
    readyAt = 0;
    status(`Word power: ${RULES[m.preset].label}${usesPower(m) ? ` · scoring by ${m.scorer}` : ''}`);
  }

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || (e.key !== 'p' && e.key !== 'P')) return;
    if (e.shiftKey) setMode({ ...mode, scorer: mode.scorer === 'words' ? 'features' : 'words' });
    else setMode({ ...mode, preset: PRESETS[(PRESETS.indexOf(mode.preset) + 1) % PRESETS.length] });
  });

  const s1 = (ms: number) => (ms / 1000).toFixed(1);

  const api: WordPowerUi = {
    mode: () => mode,

    gate() {
      if (!usesPower(mode)) return null;
      const now = performance.now();
      if (now >= readyAt) return null;
      return `Voice recharging: ${s1(readyAt - now)} s`;
    },

    cost: (description, elixirCost) => (usesPower(mode) ? quote(description, mode, elixir).budget : elixirCost),

    live(w: string) {
      words = w;
    },

    artHoldMs(releasedAt) {
      if (!usesPower(mode) || !RULES[mode.preset].artLanding || releasedAt === undefined) return 0;
      // The server still adds MIN_DEPLOY_DELAY after the deploy arrives, so stop short of ART_MAX.
      return Math.max(0, (ART_MAX - MIN_DEPLOY_DELAY) * 1000 - (performance.now() - releasedAt));
    },

    deployed(description: string) {
      if (!usesPower(mode)) return;
      readyAt = performance.now() + quote(description, mode, elixir).cooldown * 1000;
      words = '';
      if (desc) desc.value = '';
    },

    frame(m: MatchSource | null) {
      document.body.classList.toggle('wp-noelixir', usesPower(mode) && RULES[mode.preset].elixir === 'none');
      if (m) m.power = mode;
      el.hidden = !m || m.status !== 'playing';
      if (el.hidden) return;
      elixir = m!.elixir;
      const r = RULES[mode.preset];
      q('.wmMode').innerHTML = usesPower(mode)
        ? `Word power: <b>${r.label}</b> · by ${mode.scorer}`
        : `Word power <b>off</b>`;
      const text = q('.wmText'), fill = q('.wmFill'), wait = q('.wmWait');
      if (!usesPower(mode)) {
        fill.style.width = wait.style.width = '0';
        text.textContent = 'elixir pricing, as before';
        return;
      }
      const now = performance.now();
      const qt = quote(words, mode, elixir);
      const max = budgetFor(MAX_DETAIL);
      if (qt.detail > lastDetail) {
        el.classList.remove('pulse');
        void el.offsetWidth; // restart the animation
        el.classList.add('pulse');
      }
      lastDetail = qt.detail;
      el.classList.toggle('op', qt.tier === 'overpowered');
      const recharge = readyAt - now;
      wait.style.width = recharge > 0 ? `${Math.min(1, recharge / 10000) * 100}%` : '0';
      if (!words.trim()) {
        fill.style.width = '0';
        text.textContent = recharge > 0 ? `voice recharging ${s1(recharge)} s` : `ready · plain troop = ${PLAIN_BUDGET}, every describing word adds 1`;
        return;
      }
      fill.style.width = `${(qt.budget / max) * 100}%`;
      const costs: string[] = [];
      if (qt.cooldown) costs.push(`voice lock ${qt.cooldown.toFixed(1)} s`);
      if (r.elixir === 'cap') {
        const want = budgetFor(qt.detail);
        costs.push(want > qt.budget ? `costs ${qt.budget} elixir (wanted ${want})` : `costs ${qt.budget} elixir`);
      }
      text.textContent = `${qt.tier} · power ${qt.budget} (${(qt.budget / PLAIN_BUDGET).toFixed(1)}× plain)${costs.length ? ' · ' + costs.join(' · ') : ''}`;
    },
  };
  return api;
}
