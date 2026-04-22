(() => {
  const SHOW_DELAY_MS = 300;
  const GAP = 6;

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let currentTarget: HTMLElement | null = null;
  let showTimer: number | undefined;

  function position(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = rect.bottom + GAP;
    if (top + tipRect.height > vh - 4) {
      top = rect.top - tipRect.height - GAP;
    }
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(4, Math.min(left, vw - tipRect.width - 4));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function show(target: HTMLElement, text: string): void {
    currentTarget = target;
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.classList.remove('is-visible');
    position(target);
    requestAnimationFrame(() => tooltip.classList.add('is-visible'));
  }

  function hide(): void {
    currentTarget = null;
    tooltip.classList.remove('is-visible');
    tooltip.hidden = true;
    if (showTimer !== undefined) {
      window.clearTimeout(showTimer);
      showTimer = undefined;
    }
  }

  function findTarget(ev: Event): HTMLElement | null {
    const t = ev.target as Element | null;
    return t?.closest<HTMLElement>('[data-tooltip]') ?? null;
  }

  function tooltipText(el: HTMLElement): string {
    return el.dataset.tooltip ?? '';
  }

  document.addEventListener('mouseover', (e) => {
    const el = findTarget(e);
    if (!el || el === currentTarget) return;
    const text = tooltipText(el);
    if (!text) return;
    if (showTimer !== undefined) window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(el, text), SHOW_DELAY_MS);
  });

  document.addEventListener('mouseout', (e) => {
    const el = findTarget(e);
    const related = (e.relatedTarget as Element | null)?.closest<HTMLElement>('[data-tooltip]');
    if (el && el !== related) hide();
  });

  document.addEventListener('focusin', (e) => {
    const el = findTarget(e);
    if (!el) return;
    const text = tooltipText(el);
    if (!text) return;
    show(el, text);
  });

  document.addEventListener('focusout', () => hide());

  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('click', hide, true);
})();
