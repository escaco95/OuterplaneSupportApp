const ZOOM_LEVELS: number[] = [0.5, 0.75, 1, 1.5, 2];
const DEFAULT_ZOOM = 1;
const DEFAULT_THEME = 'light';

const LINKS_KEY = 'community-links';
const DEFAULT_LINKS: CommunityLink[] = [
  { id: 'wiki', name: '아우터플레인 위키', url: 'https://kr.outerpedia.com/', description: '게임 정보 백과' },
  { id: 'channel', name: '아우터플레인 채널', url: 'https://arca.live/b/outerplane', description: '유저 커뮤니티' },
];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const appEl = document.querySelector<HTMLElement>('.app')!;

/* ---------- community links state ---------- */
function loadLinks(): CommunityLink[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    if (!raw) return structuredClone(DEFAULT_LINKS);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return structuredClone(DEFAULT_LINKS);
    return parsed.filter(
      (l): l is CommunityLink =>
        !!l && typeof l.id === 'string' && typeof l.name === 'string' && typeof l.url === 'string'
    );
  } catch {
    return structuredClone(DEFAULT_LINKS);
  }
}

function saveLinks(): void {
  localStorage.setItem(LINKS_KEY, JSON.stringify(communityLinks));
}

let communityLinks: CommunityLink[] = loadLinks();
let editingId: string | null = null;

/* ---------- home rendering ---------- */
const linkGrid = $<HTMLDivElement>('link-grid');

function renderHome(): void {
  linkGrid.replaceChildren();
  for (const link of communityLinks) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'link-tile';
    tile.dataset.tooltip = link.description
      ? `${link.name}\n${link.description}\n${link.url}`
      : `${link.name}\n${link.url}`;
    tile.setAttribute('aria-label', link.name);

    const fallback = document.createElement('span');
    fallback.className = 'link-tile__fallback';
    fallback.textContent = (link.name || '?').trim().charAt(0);
    tile.appendChild(fallback);

    const setIcon = (src: string): void => {
      const img = document.createElement('img');
      img.className = 'link-tile__icon';
      img.alt = '';
      img.src = src;
      img.addEventListener('error', () => {
        img.replaceWith(fallback);
      });
      fallback.replaceWith(img);
    };

    if (window.favicon) {
      window.favicon
        .get(link.url)
        .then((src) => {
          if (src) setIcon(src);
        })
        .catch(() => {});
    }

    tile.addEventListener('click', () => window.links.open(link.url));
    linkGrid.appendChild(tile);
  }
}

/* ---------- settings: link list ---------- */
const linkList = $<HTMLUListElement>('link-list');
const linkEditor = $<HTMLFormElement>('link-editor');

function editorInput(name: 'name' | 'description' | 'url'): HTMLInputElement {
  return linkEditor.elements.namedItem(name) as HTMLInputElement;
}

function iconBtn(
  symbol: string,
  label: string,
  disabled: boolean,
  onClick: () => void
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.textContent = symbol;
  b.dataset.tooltip = label;
  b.setAttribute('aria-label', label);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderSettingsList(): void {
  linkList.replaceChildren();
  communityLinks.forEach((link, i) => {
    const li = document.createElement('li');
    li.className = 'link-row';

    const info = document.createElement('div');
    info.className = 'link-row__info';

    const name = document.createElement('span');
    name.className = 'link-row__name';
    name.textContent = link.name;

    const url = document.createElement('span');
    url.className = 'link-row__url';
    url.textContent = link.url;

    info.append(name, url);

    const actions = document.createElement('div');
    actions.className = 'link-row__actions';
    actions.append(
      iconBtn('▲', '위로', i === 0, () => moveLink(i, -1)),
      iconBtn('▼', '아래로', i === communityLinks.length - 1, () => moveLink(i, 1)),
      iconBtn('✎', '편집', false, () => startEdit(link.id)),
      iconBtn('✕', '삭제', false, () => deleteLink(link.id))
    );

    li.append(info, actions);
    linkList.appendChild(li);
  });
}

function moveLink(i: number, dir: number): void {
  const j = i + dir;
  if (j < 0 || j >= communityLinks.length) return;
  [communityLinks[i], communityLinks[j]] = [communityLinks[j], communityLinks[i]];
  saveLinks();
  renderSettingsList();
  renderHome();
}

function deleteLink(id: string): void {
  const link = communityLinks.find((l) => l.id === id);
  if (!link) return;
  if (!confirm(`"${link.name}" 버튼을 삭제할까요?`)) return;
  communityLinks = communityLinks.filter((l) => l.id !== id);
  saveLinks();
  renderSettingsList();
  renderHome();
}

function openEditor(link: CommunityLink | null): void {
  editingId = link ? link.id : null;
  linkEditor.hidden = false;
  editorInput('name').value = link ? link.name : '';
  editorInput('description').value = link ? link.description || '' : '';
  editorInput('url').value = link ? link.url : '';
  editorInput('name').focus();
}

function closeEditor(): void {
  editingId = null;
  linkEditor.hidden = true;
  linkEditor.reset();
}

function startEdit(id: string): void {
  const link = communityLinks.find((l) => l.id === id);
  if (link) openEditor(link);
}

linkEditor.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    name: editorInput('name').value.trim(),
    description: editorInput('description').value.trim(),
    url: editorInput('url').value.trim(),
  };
  if (!data.name || !data.url) return;
  try {
    const u = new URL(data.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      alert('http 또는 https URL만 허용됩니다.');
      return;
    }
  } catch {
    alert('유효한 URL이 아닙니다.');
    return;
  }

  if (editingId) {
    const i = communityLinks.findIndex((l) => l.id === editingId);
    if (i >= 0) communityLinks[i] = { ...communityLinks[i], ...data };
  } else {
    communityLinks.push({ id: crypto.randomUUID(), ...data });
  }
  saveLinks();
  closeEditor();
  renderSettingsList();
  renderHome();
});

$<HTMLButtonElement>('btn-link-add').addEventListener('click', () => openEditor(null));
$<HTMLButtonElement>('btn-link-cancel').addEventListener('click', closeEditor);
$<HTMLButtonElement>('btn-link-restore').addEventListener('click', () => {
  if (!confirm('커뮤니티 버튼을 기본값으로 복원할까요? 현재 목록이 대체됩니다.')) return;
  communityLinks = structuredClone(DEFAULT_LINKS);
  saveLinks();
  closeEditor();
  renderSettingsList();
  renderHome();
});

/* ---------- tools: find ldplayer ---------- */
const trackingStatusEl = $<HTMLDivElement>('tracking-status');

function renderTrackingStatus(info: { key: string; title: string } | null): void {
  if (!info) {
    trackingStatusEl.textContent = '선택된 창 없음';
    trackingStatusEl.classList.remove('is-active');
  } else {
    trackingStatusEl.textContent = `추적 중: ${info.title || '(제목 없음)'}`;
    trackingStatusEl.classList.add('is-active');
  }
}

window.ldplayer.onTrackedChange(renderTrackingStatus);
window.ldplayer.getTracked().then(renderTrackingStatus);

$<HTMLButtonElement>('btn-find-ldplayer').addEventListener('click', async () => {
  const windows = await window.ldplayer.find();
  if (windows.length === 0) {
    alert('실행 중인 LDPlayer 창을 찾을 수 없습니다.');
    return;
  }
  await window.ldplayer.pick();
});

/* ---------- danger zone ---------- */
$<HTMLButtonElement>('btn-reset-data').addEventListener('click', async () => {
  if (!confirm('모든 앱 데이터(설정, 커뮤니티 버튼, 아이콘 캐시)를 초기화할까요?')) return;
  localStorage.clear();
  await window.appData.reset();
  location.reload();
});

/* ---------- window controls ---------- */
const { minimize, toggleMaximize, close: closeWindow, onMaximizeChange } = window.windowControls;

$<HTMLButtonElement>('btn-min').addEventListener('click', minimize);
$<HTMLButtonElement>('btn-max').addEventListener('click', toggleMaximize);
$<HTMLButtonElement>('btn-close').addEventListener('click', closeWindow);

const maxBtn = $<HTMLButtonElement>('btn-max');
onMaximizeChange((isMax) => {
  maxBtn.innerHTML = isMax
    ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  const label = isMax ? '이전 크기로 복원' : '최대화';
  maxBtn.setAttribute('aria-label', label);
  maxBtn.dataset.tooltip = label;
});

/* ---------- navigation ---------- */
function navigate(page: string): void {
  appEl.dataset.activePage = page;
  document.querySelectorAll<HTMLElement>('.nav__item').forEach((n) => {
    n.classList.toggle('is-active', n.dataset.page === page);
  });
  document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
    p.classList.toggle('is-active', p.dataset.page === page);
  });
}

document.querySelectorAll<HTMLElement>('.nav__item').forEach((item) => {
  item.addEventListener('click', () => {
    if (item.dataset.page) navigate(item.dataset.page);
  });
});

/* ---------- theme ---------- */
const themeThumbs = document.querySelectorAll<HTMLElement>('#theme-picker .theme-thumb');
const THEMES: string[] = Array.from(themeThumbs)
  .map((b) => b.dataset.theme)
  .filter((t): t is string => !!t);

function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  themeThumbs.forEach((b) => {
    b.classList.toggle('is-active', b.dataset.theme === theme);
  });
}

themeThumbs.forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.theme) applyTheme(b.dataset.theme);
  });
});

const savedTheme = localStorage.getItem('theme');
applyTheme(savedTheme && THEMES.includes(savedTheme) ? savedTheme : DEFAULT_THEME);

/* ---------- zoom ---------- */
const zoomSelect = $<HTMLSelectElement>('zoom-select');

function applyZoom(factor: number): void {
  window.zoom.set(factor);
  localStorage.setItem('zoom', String(factor));
  zoomSelect.value = String(factor);
}

function zoomStep(dir: number): void {
  const current = window.zoom.get();
  let idx = ZOOM_LEVELS.findIndex((v) => Math.abs(v - current) < 0.001);
  if (idx === -1) idx = ZOOM_LEVELS.indexOf(1);
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + dir));
  applyZoom(ZOOM_LEVELS[next]);
}

zoomSelect.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement;
  applyZoom(parseFloat(target.value));
});

document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    zoomStep(1);
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    zoomStep(-1);
  } else if (e.key === '0') {
    e.preventDefault();
    applyZoom(1);
  }
});

const savedZoom = parseFloat(localStorage.getItem('zoom') ?? '');
applyZoom(ZOOM_LEVELS.includes(savedZoom) ? savedZoom : DEFAULT_ZOOM);

/* ---------- craft (auto-reroll) ---------- */
// Kept in renderer state (not persisted) — user re-enters config each session.
// If persistence becomes desirable, dump to localStorage on start.
const CRAFT_LOG_CAP = 100;

type CraftView = 'idle' | 'running' | 'terminal';

const craftValuableBox = $<HTMLDivElement>('craft-valuable');
const craftTemplateInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('.craft-template__input')
);
const craftTemplateHint = $<HTMLDivElement>('craft-template-hint');
const craftMaxInput = $<HTMLInputElement>('craft-max');
const craftCumulativeEl = $<HTMLDivElement>('craft-cumulative');
const craftStartBtn = $<HTMLButtonElement>('craft-start');
const craftStopBtn = $<HTMLButtonElement>('craft-stop');
const craftRestartBtn = $<HTMLButtonElement>('craft-restart');
const craftProgressCounter = $<HTMLSpanElement>('craft-progress-counter');
const craftProgressMeta = $<HTMLSpanElement>('craft-progress-meta');
const craftProgressFill = $<HTMLDivElement>('craft-progress-fill');
const craftPreviewEl = $<HTMLDivElement>('craft-preview');
const craftTerminalPreviewEl = $<HTMLDivElement>('craft-terminal-preview');
const craftLogEl = $<HTMLPreElement>('craft-log');
const craftLogToggle = $<HTMLButtonElement>('craft-log-toggle');
const craftTerminalHead = $<HTMLDivElement>('craft-terminal-head');
const craftTerminalBody = $<HTMLDivElement>('craft-terminal-body');

const craftViews = Array.from(
  document.querySelectorAll<HTMLElement>('.craft-view[data-craft-view]')
);

const valuableChecked = new Set<string>();
let craftCatalog: string[] = [];
let craftLogLines: string[] = [];
let craftCurrentMax = 0;
let craftLogHidden = false;

function setCraftView(view: CraftView): void {
  for (const el of craftViews) {
    el.hidden = el.dataset.craftView !== view;
  }
}

function renderCraftValuable(): void {
  craftValuableBox.replaceChildren();
  for (const stat of craftCatalog) {
    const label = document.createElement('label');
    label.className = 'craft-valuable__item';
    if (valuableChecked.has(stat)) label.classList.add('is-checked');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = stat;
    input.checked = valuableChecked.has(stat);
    input.addEventListener('change', () => {
      if (input.checked) valuableChecked.add(stat);
      else valuableChecked.delete(stat);
      label.classList.toggle('is-checked', input.checked);
    });
    const text = document.createElement('span');
    text.textContent = stat;
    label.append(input, text);
    craftValuableBox.append(label);
  }
}

function readTemplate(): [number, number, number, number] {
  const vals = craftTemplateInputs.map((inp) => {
    let n = parseInt(inp.value, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 4) n = 4;
    return n;
  });
  while (vals.length < 4) vals.push(0);
  return [vals[0], vals[1], vals[2], vals[3]];
}

function updateTemplateHint(): void {
  const tpl = readTemplate();
  const reqs = tpl.filter((r) => r > 0).sort((a, b) => b - a);
  if (reqs.length === 0) {
    craftTemplateHint.textContent = '모든 슬롯이 0 — 어떤 결과든 매칭됨 (의도 확인 필요)';
    return;
  }
  const counts = new Map<number, number>();
  for (const r of reqs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const parts = Array.from(counts.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([r, n]) => `위력 ${r}+ ${n}개`);
  const zeros = 4 - reqs.length;
  if (zeros > 0) parts.push(`자유 ${zeros}개`);
  craftTemplateHint.textContent = parts.join(' · ');
}

function refreshCumulative(s: CraftSessionState): void {
  craftCumulativeEl.innerHTML = '';
  const l1 = document.createElement('div');
  l1.className = 'craft-cumulative__line';
  l1.textContent = `누적: ${s.totalAttempts} 시도 · ${s.totalHits} 성공 · 현재 streak ${s.currentStreak} (최장 ${s.longestStreak})`;
  craftCumulativeEl.append(l1);
}

function renderPreview(target: HTMLElement, rows: CraftScanRow[], valuable: Set<string>): void {
  target.replaceChildren();
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'craft-preview__row';
    const bar = document.createElement('div');
    bar.className = 'craft-preview__rank';
    for (let i = 0; i < 4; i++) {
      const seg = document.createElement('span');
      seg.className = 'craft-preview__segment';
      if (i < row.rank) seg.classList.add('is-filled');
      bar.append(seg);
    }
    const stat = document.createElement('span');
    stat.className = 'craft-preview__stat';
    if (row.stat === null) {
      stat.classList.add('craft-preview__stat--unknown');
      stat.textContent = 'UNKNOWN';
    } else {
      stat.textContent = row.stat;
      if (valuable.has(row.stat)) stat.classList.add('craft-preview__stat--valuable');
    }
    rowEl.append(bar, stat);
    target.append(rowEl);
  }
}

function appendLog(line: string): void {
  craftLogLines.push(line);
  if (craftLogLines.length > CRAFT_LOG_CAP) {
    craftLogLines.splice(0, craftLogLines.length - CRAFT_LOG_CAP);
  }
  if (!craftLogHidden) {
    craftLogEl.textContent = craftLogLines.join('\n');
    craftLogEl.scrollTop = craftLogEl.scrollHeight;
  }
}

function resetCraftLog(): void {
  craftLogLines = [];
  craftLogEl.textContent = '';
}

function setProgress(iter: number, max: number): void {
  craftProgressCounter.textContent = `${iter}/${max}`;
  const pct = max > 0 ? (iter / max) * 100 : 0;
  craftProgressFill.style.width = `${pct}%`;
}

for (const inp of craftTemplateInputs) {
  inp.addEventListener('input', updateTemplateHint);
}

craftLogToggle.addEventListener('click', () => {
  craftLogHidden = !craftLogHidden;
  craftLogEl.classList.toggle('craft-log--hidden', craftLogHidden);
  craftLogToggle.textContent = craftLogHidden ? '보이기' : '숨기기';
  if (!craftLogHidden) {
    craftLogEl.textContent = craftLogLines.join('\n');
    craftLogEl.scrollTop = craftLogEl.scrollHeight;
  }
});

craftStartBtn.addEventListener('click', async () => {
  if (valuableChecked.size === 0) {
    alert('원하는 스탯을 하나 이상 선택해주세요.');
    return;
  }
  const template = readTemplate();
  const maxIter = Math.max(1, Math.min(1000, parseInt(craftMaxInput.value, 10) || 50));
  craftCurrentMax = maxIter;
  resetCraftLog();
  setProgress(0, maxIter);
  craftProgressMeta.textContent = '';
  craftPreviewEl.replaceChildren();
  setCraftView('running');
  craftStartBtn.disabled = true;

  const res = await window.craft.start({
    valuable: Array.from(valuableChecked),
    template,
    maxIter,
  });
  if (!res.ok) {
    renderTerminal({
      kind: 'fail',
      title: '시작 실패',
      reason: res.reason ?? 'unknown',
    });
  }
});

craftStopBtn.addEventListener('click', () => {
  craftStopBtn.disabled = true;
  craftStopBtn.textContent = '중단 중…';
  window.craft.stop();
});

craftRestartBtn.addEventListener('click', async () => {
  setCraftView('idle');
  craftStartBtn.disabled = false;
  craftStopBtn.disabled = false;
  craftStopBtn.textContent = '■ 중단';
  const s = await window.craft.getInitialState();
  refreshCumulative(s);
});

interface TerminalArgs {
  kind: 'hit' | 'limit' | 'fail' | 'detection-failure';
  title: string;
  reason?: string;
  rows?: CraftScanRow[];
  body?: Array<{ label: string; value: string }>;
}

function renderTerminal(a: TerminalArgs): void {
  setCraftView('terminal');
  craftStartBtn.disabled = false;
  craftStopBtn.disabled = false;
  craftStopBtn.textContent = '■ 중단';

  craftTerminalHead.className = `craft-terminal-head craft-terminal-head--${a.kind}`;
  const icon = a.kind === 'hit' ? '🎉' : a.kind === 'limit' ? '⏱' : '⚠';
  craftTerminalHead.textContent = `${icon}  ${a.title}`;

  if (a.rows) renderPreview(craftTerminalPreviewEl, a.rows, valuableChecked);
  else craftTerminalPreviewEl.replaceChildren();

  craftTerminalBody.replaceChildren();
  if (a.reason) {
    const el = document.createElement('div');
    el.className = 'craft-terminal-body__line';
    el.textContent = a.reason;
    craftTerminalBody.append(el);
  }
  if (a.body) {
    for (const b of a.body) {
      const el = document.createElement('div');
      el.className = 'craft-terminal-body__line';
      el.textContent = `${b.label}: ${b.value}`;
      craftTerminalBody.append(el);
    }
  }
}

window.craft.onEvent((e) => {
  switch (e.type) {
    case 'iteration':
      setProgress(e.iter, e.maxIter);
      craftProgressMeta.textContent = `streak ${valuableChecked.size > 0 ? '…' : ''}`;
      renderPreview(craftPreviewEl, e.rows, valuableChecked);
      appendLog(e.logLine);
      break;
    case 'settled':
      if (e.timedOut) appendLog(`  [settle] timeout ${e.settleMs}ms`);
      break;
    case 'hit': {
      refreshCumulative(e.state);
      renderTerminal({
        kind: 'hit',
        title: '원하는 조합 획득!',
        rows: e.rows,
        body: [
          { label: '시도', value: `${e.iter}회` },
          { label: '소요', value: `${(e.elapsedMs / 1000).toFixed(1)}s` },
          {
            label: '누적',
            value: `${e.state.totalAttempts} 시도 / ${e.state.totalHits} 성공 (streak 리셋됨)`,
          },
        ],
      });
      break;
    }
    case 'limit':
      refreshCumulative(e.state);
      renderTerminal({
        kind: 'limit',
        title: `최대 시도 도달 (${craftCurrentMax}회)`,
        body: [
          { label: '소요', value: `${(e.elapsedMs / 1000).toFixed(1)}s` },
          {
            label: '누적',
            value: `${e.state.totalAttempts} 시도 · ${e.state.totalHits} 성공 · 현재 streak ${e.state.currentStreak}`,
          },
        ],
      });
      break;
    case 'fail':
      renderTerminal({
        kind: 'fail',
        title: '중단',
        reason: e.reason,
        body: e.screenFailedRois
          ? [{ label: 'ROI', value: e.screenFailedRois.join(', ') }]
          : undefined,
      });
      break;
    case 'detection-failure':
      renderTerminal({
        kind: 'detection-failure',
        title: '인식 실패',
        reason:
          '내부 이미지 인식 로직이 이 화면을 처리하지 못했습니다. 개발자에게 문의해주세요.',
        rows: e.rows,
        body: [{ label: '실패 행', value: e.failedRows.join(', ') }],
      });
      break;
    case 'done':
      // Terminal view already rendered by the event that preceded 'done'.
      break;
  }
});

async function initCraft(): Promise<void> {
  try {
    craftCatalog = await window.craft.getCatalog();
    renderCraftValuable();
    const s = await window.craft.getInitialState();
    refreshCumulative(s);
    updateTemplateHint();
  } catch (err) {
    console.error('craft init failed:', err);
  }
}
initCraft();

/* ---------- initial render ---------- */
renderHome();
renderSettingsList();
