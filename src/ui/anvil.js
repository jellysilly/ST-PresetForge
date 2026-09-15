/**
 * The floating anvil button.
 *
 * Drags with mouse or touch, remembers where it was put as a percentage of the
 * viewport (so it survives rotation and window resizes), and tells a click
 * apart from a drag by distance rather than by timing.
 */

import { getSettings, updateSettings } from './../settings.js';

const DRAG_THRESHOLD = 6; // px of travel before a press becomes a drag
const EDGE = 8;           // keep this much gap from the viewport edge

const ANVIL_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M8 22h16.5c1.2 0 2.2.7 2.7 1.8 1.9 4.2 6.1 7.2 11.3 7.2H56c0 6.6-4.4 12.2-10.4 14l3.4 6.6c.5 1-.2 2.2-1.3 2.2H16.3c-1.1 0-1.8-1.2-1.3-2.2l3.4-6.6c-3.6-1.1-6.6-3.5-8.4-6.7H20c1.1 0 2-.9 2-2s-.9-2-2-2H8.4C8.1 33 8 32 8 31v-9z"/>
  <path d="M24 14h10a2 2 0 0 1 2 2v4H22v-4a2 2 0 0 1 2-2z" opacity=".65"/>
</svg>`;

let button = null;
let onActivate = () => {};

/** Clamp a pixel position so the whole button stays on screen. */
function clampPosition(x, y, width, height) {
    const maxX = window.innerWidth - width - EDGE;
    const maxY = window.innerHeight - height - EDGE;
    return {
        x: Math.min(Math.max(x, EDGE), Math.max(EDGE, maxX)),
        y: Math.min(Math.max(y, EDGE), Math.max(EDGE, maxY)),
    };
}

/** Put the button where the settings say, defaulting to the lower right. */
function applyStoredPosition() {
    if (!button) return;
    const settings = getSettings();
    const rect = button.getBoundingClientRect();
    const width = rect.width || 52;
    const height = rect.height || 52;

    const hasStored = typeof settings.buttonX === 'number' && typeof settings.buttonY === 'number';
    const rawX = hasStored ? (settings.buttonX / 100) * window.innerWidth : window.innerWidth - width - 20;
    const rawY = hasStored ? (settings.buttonY / 100) * window.innerHeight : window.innerHeight - height - 110;

    const { x, y } = clampPosition(rawX, rawY, width, height);
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
}

/** Store the current position as viewport percentages. */
function storePosition() {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    updateSettings({
        buttonX: (rect.left / window.innerWidth) * 100,
        buttonY: (rect.top / window.innerHeight) * 100,
    });
}

function beginDrag(startEvent) {
    // Ignore anything but the primary mouse button.
    if (startEvent.type === 'mousedown' && startEvent.button !== 0) return;

    const point = startEvent.touches?.[0] ?? startEvent;
    const rect = button.getBoundingClientRect();
    const offsetX = point.clientX - rect.left;
    const offsetY = point.clientY - rect.top;
    const startX = point.clientX;
    const startY = point.clientY;

    let dragging = false;
    const isTouch = startEvent.type === 'touchstart';

    const move = event => {
        const current = event.touches?.[0] ?? event;
        const travel = Math.hypot(current.clientX - startX, current.clientY - startY);

        if (!dragging && travel > DRAG_THRESHOLD) {
            dragging = true;
            button.classList.add('pf-anvil--dragging');
        }
        if (!dragging) return;

        // Only now do we own the gesture, so scrolling still works if it was a tap.
        if (event.cancelable) event.preventDefault();

        const { x, y } = clampPosition(
            current.clientX - offsetX,
            current.clientY - offsetY,
            rect.width,
            rect.height,
        );
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
    };

    const end = event => {
        document.removeEventListener(isTouch ? 'touchmove' : 'mousemove', move);
        document.removeEventListener(isTouch ? 'touchend' : 'mouseup', end);
        document.removeEventListener('touchcancel', end);

        if (dragging) {
            button.classList.remove('pf-anvil--dragging');
            storePosition();
            // Swallow the click the browser would fire after the drag.
            if (event.cancelable) event.preventDefault();
        } else {
            button.classList.add('pf-anvil--struck');
            setTimeout(() => button?.classList.remove('pf-anvil--struck'), 420);
            onActivate();
        }
    };

    document.addEventListener(isTouch ? 'touchmove' : 'mousemove', move, { passive: false });
    document.addEventListener(isTouch ? 'touchend' : 'mouseup', end);
    document.addEventListener('touchcancel', end);
}

/**
 * Create the button.
 * @param {() => void} handler invoked on a real click (not a drag)
 */
export function mountAnvil(handler) {
    onActivate = handler;
    if (button) return button;

    button = document.createElement('button');
    button.id = 'pf-anvil';
    button.className = 'pf-anvil';
    button.type = 'button';
    button.setAttribute('aria-label', 'PresetForge');
    button.title = 'PresetForge';
    button.innerHTML = ANVIL_SVG;

    button.addEventListener('mousedown', beginDrag);
    button.addEventListener('touchstart', beginDrag, { passive: true });
    // The drag handler already decided whether this was a click.
    button.addEventListener('click', event => event.preventDefault());
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
        }
    });

    document.body.append(button);
    applyStoredPosition();
    requestAnimationFrame(() => button?.classList.add('pf-anvil--ready'));

    window.addEventListener('resize', applyStoredPosition);
    window.addEventListener('orientationchange', () => setTimeout(applyStoredPosition, 150));

    setAnvilVisible(getSettings().buttonVisible !== false);
    return button;
}

/** @param {boolean} visible */
export function setAnvilVisible(visible) {
    button?.classList.toggle('pf-anvil--hidden', !visible);
}

/** Drop the stored position and snap back to the default corner. */
export function resetAnvilPosition() {
    updateSettings({ buttonX: null, buttonY: null });
    applyStoredPosition();
}

/** Mark the button busy while a generation runs. */
export function setAnvilBusy(busy) {
    button?.classList.toggle('pf-anvil--busy', !!busy);
}
