/**
 * The floating anvil button.
 *
 * Drags with mouse, touch or pen through a single pointer-event stream, so a
 * tap can never be handled twice; remembers where it was put as a percentage of
 * the viewport (so it survives rotation and window resizes), and tells a click
 * apart from a drag by distance rather than by timing.
 */

import { getSettings, updateSettings } from './../settings.js';
import { toast } from './dom.js';

/**
 * How far a press may travel before it counts as a drag. Small mice and
 * trackpads move several pixels during an ordinary click, so a tight threshold
 * swallows real clicks; this is measured as a diagonal, not per axis.
 */
const DRAG_THRESHOLD = 10;
const EDGE = 8;           // keep this much gap from the viewport edge

const ANVIL_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M8 22h16.5c1.2 0 2.2.7 2.7 1.8 1.9 4.2 6.1 7.2 11.3 7.2H56c0 6.6-4.4 12.2-10.4 14l3.4 6.6c.5 1-.2 2.2-1.3 2.2H16.3c-1.1 0-1.8-1.2-1.3-2.2l3.4-6.6c-3.6-1.1-6.6-3.5-8.4-6.7H20c1.1 0 2-.9 2-2s-.9-2-2-2H8.4C8.1 33 8 32 8 31v-9z"/>
  <path d="M24 14h10a2 2 0 0 1 2 2v4H22v-4a2 2 0 0 1 2-2z" opacity=".65"/>
</svg>`;

let button = null;
let onActivate = () => {};

/**
 * The button's untransformed layout box. getBoundingClientRect() reports the
 * idle float and the drag scale as part of the geometry, which would feed a
 * lie back into the stored position on every drag.
 */
function layoutBox() {
    return {
        left: button.offsetLeft,
        top: button.offsetTop,
        width: button.offsetWidth || 52,
        height: button.offsetHeight || 52,
    };
}

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
    const { width, height } = layoutBox();

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
    const { left, top } = layoutBox();
    updateSettings({
        buttonX: (left / window.innerWidth) * 100,
        buttonY: (top / window.innerHeight) * 100,
    });
}

/** Open the panel, and say so if that throws instead of failing silently. */
function activate() {
    try {
        onActivate();
    } catch (error) {
        console.error('[ST-PresetForge] could not open the panel', error);
        toast('error', `PresetForge: ${error?.message ?? error}`);
    }
}

/**
 * Press, drag, release — one pointer stream for every input device.
 *
 * Listening for mouse and touch separately is what broke this on phones: after
 * a tap the browser also emits compatibility mouse events, so the same press
 * ran twice and the second run toggled the panel straight back shut.
 */
function onPointerDown(event) {
    // Primary button only, and only one finger at a time.
    if (event.button !== 0 || !button || button.dataset.pfPointer) return;

    const box = layoutBox();
    const offsetX = event.clientX - box.left;
    const offsetY = event.clientY - box.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    button.dataset.pfPointer = String(event.pointerId);
    try {
        button.setPointerCapture(event.pointerId);
    } catch {
        // Capture is a nicety; the listeners below still work without it.
    }

    const move = moveEvent => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const travel = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);

        if (!dragging && travel > DRAG_THRESHOLD) {
            dragging = true;
            button.classList.add('pf-anvil--dragging');
        }
        if (!dragging) return;

        if (moveEvent.cancelable) moveEvent.preventDefault();
        const { x, y } = clampPosition(
            moveEvent.clientX - offsetX,
            moveEvent.clientY - offsetY,
            box.width,
            box.height,
        );
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
    };

    const finish = endEvent => {
        if (endEvent.pointerId !== event.pointerId) return;
        button.removeEventListener('pointermove', move);
        button.removeEventListener('pointerup', finish);
        button.removeEventListener('pointercancel', cancel);
        delete button.dataset.pfPointer;
        try {
            button.releasePointerCapture(event.pointerId);
        } catch {
            // Already released, or never captured.
        }

        if (dragging) {
            button.classList.remove('pf-anvil--dragging');
            storePosition();
            return;
        }

        button.classList.add('pf-anvil--struck');
        setTimeout(() => button?.classList.remove('pf-anvil--struck'), 420);
        activate();
    };

    const cancel = cancelEvent => {
        if (cancelEvent.pointerId !== event.pointerId) return;
        dragging = false;
        button.classList.remove('pf-anvil--dragging');
        finish(cancelEvent);
    };

    button.addEventListener('pointermove', move, { passive: false });
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', cancel);
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

    button.addEventListener('pointerdown', onPointerDown);
    // The pointer handler already decided whether this was a click, and a tap
    // also produces a legacy click we must not act on a second time.
    button.addEventListener('click', event => event.preventDefault());
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
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
