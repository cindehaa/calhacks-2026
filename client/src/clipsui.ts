// The round's highlight clips on the result screen: a row of looping thumbnails under the MVP card,
// filled in as clips.ts finishes cutting them. A click opens one large, with Save and Share (the
// system share sheet, where the browser has one that takes files).
import './clips.css';
import type { Clip } from './clips';
import { fileName } from './clipname';

const POST_TEXT = 'A highlight from my match in Artifice';

let row: HTMLElement | null = null;
let clips: (Clip | null)[] = [];
let round = 0;

function panel(): HTMLElement {
  let card = document.getElementById('clipsCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'clipsCard';
    card.className = 'gPanel clipsCard';
    card.innerHTML = '<div class="gFace"><span class="gLabel">Highlights</span><div class="clipRow"></div></div>';
    const mvpCard = document.getElementById('mvpCard');
    if (mvpCard) mvpCard.after(card);
    else document.querySelector('#result .resultCol .actions')?.before(card);
  }
  row = card.querySelector('.clipRow');
  return card;
}

// A new round: clear the last one's clips. Returns a token that clipsAdd checks, so clips still
// being cut from an earlier round don't land in this one.
export function clipsReset(): number {
  for (const c of clips) if (c) URL.revokeObjectURL(c.url);
  clips = [];
  document.getElementById('clipsCard')?.remove();
  row = null;
  return ++round;
}

// `n` clips are on their way.
export function clipsExpect(token: number, n: number): void {
  if (token !== round || !n) return;
  const card = panel();
  card.hidden = false;
  clips = Array(n).fill(null);
  row!.innerHTML = clips.map((_, i) => `<button class="clipThumb loading" data-i="${i}" disabled><span class="clipWait">Making clip…</span></button>`).join('');
}

export function clipsAdd(token: number, clip: Clip, i: number): void {
  if (token !== round || !row) {
    URL.revokeObjectURL(clip.url);
    return;
  }
  clips[i] = clip;
  const btn = row.querySelector<HTMLButtonElement>(`[data-i="${i}"]`);
  if (!btn) return;
  btn.className = 'clipThumb';
  btn.disabled = false;
  btn.innerHTML = `<video src="${clip.url}" muted loop playsinline autoplay></video><span class="clipName"></span>`;
  btn.querySelector('.clipName')!.textContent = clip.label;
  btn.onclick = () => openClip(i);
}

// A clip that failed to cut: its slot goes, and the whole card if none are left.
export function clipsDrop(token: number, i: number): void {
  if (token !== round || !row) return;
  row.querySelector(`[data-i="${i}"]`)?.remove();
  if (!row.children.length) document.getElementById('clipsCard')!.hidden = true;
}

// ---------- the large view ----------

function viewer(): HTMLElement {
  let el = document.getElementById('clipView');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'clipView';
  el.className = 'overlay gOverlay';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'clipTitle');
  el.innerHTML = `<div class="gPanel clipPanel"><div class="gFace">
    <h2 id="clipTitle"></h2>
    <video id="clipVideo" controls loop playsinline></video>
    <p class="clipNote" id="clipNote" hidden></p>
    <div class="clipActions">
      <button id="clipSave" class="slab amber"><span class="face"><b>Save</b></span></button>
      <button id="clipShare" class="slab stone"><span class="face"><b>Share</b></span></button>
      <button id="clipClose" class="slab stone"><span class="face"><b>Close</b></span></button>
    </div>
  </div></div>`;
  document.body.append(el);
  el.addEventListener('click', e => { if (e.target === el) closeClip() });
  el.querySelector<HTMLButtonElement>('#clipClose')!.onclick = closeClip;
  addEventListener('keydown', e => { if (e.key === 'Escape' && !el!.hidden) closeClip() });
  return el;
}


function save(c: Clip, i: number): void {
  const a = Object.assign(document.createElement('a'), { href: c.url, download: fileName(c, i, clips) });
  document.body.append(a);
  a.click();
  a.remove();
}

function openClip(i: number): void {
  const c = clips[i];
  if (!c) return;
  const el = viewer();
  const video = el.querySelector<HTMLVideoElement>('#clipVideo')!;
  const note = el.querySelector<HTMLElement>('#clipNote')!;
  el.querySelector('#clipTitle')!.textContent = c.label;
  video.src = c.url;
  void video.play().catch(() => {});
  note.hidden = true;
  const file = new File([c.blob], fileName(c, i, clips), { type: c.blob.type });
  const share = el.querySelector<HTMLButtonElement>('#clipShare')!;
  share.hidden = !navigator.canShare?.({ files: [file] });
  share.onclick = () => void navigator.share({ files: [file], text: POST_TEXT }).catch(() => {});
  el.querySelector<HTMLButtonElement>('#clipSave')!.onclick = () => {
    save(c, i);
    note.textContent = 'Clip saved.';
    note.hidden = false;
  };
  el.hidden = false;
}

function closeClip(): void {
  const el = document.getElementById('clipView');
  if (!el) return;
  el.hidden = true;
  el.querySelector<HTMLVideoElement>('#clipVideo')!.pause();
}
