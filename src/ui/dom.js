/** Small DOM helpers, so the panel code stays readable. */

/**
 * @param {string} tag
 * @param {object} [props] className / textContent / attrs / dataset / events
 * @param {Array<Node|string|null|undefined|false>} [children]
 */
export function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style') Object.assign(node.style, value);
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key in node && typeof value !== 'object') {
            node[key] = value;
        } else {
            node.setAttribute(key, value);
        }
    }

    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

/** A labelled form row. */
export function field(labelText, control, hint) {
    return el('label', { class: 'pf-field' }, [
        el('span', { class: 'pf-field__label', text: labelText }),
        control,
        hint ? el('small', { class: 'pf-field__hint', text: hint }) : null,
    ]);
}

/**
 * A <select> populated from {value,label} pairs.
 * @param {Array<{value:string,label:string}>} options
 */
export function select(options, value, onChange, props = {}) {
    const node = el('select', { class: 'pf-input', ...props });
    for (const option of options) {
        node.append(el('option', { value: option.value, text: option.label, selected: option.value === value }));
    }
    node.addEventListener('change', () => onChange(node.value));
    return node;
}

/** A checkbox row. */
export function checkbox(labelText, checked, onChange, hint) {
    const input = el('input', { type: 'checkbox', class: 'pf-checkbox', checked: !!checked });
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { class: 'pf-check' }, [
        input,
        el('span', {}, [
            el('span', { class: 'pf-check__label', text: labelText }),
            hint ? el('small', { class: 'pf-field__hint', text: hint }) : null,
        ]),
    ]);
}

/** Remove every child of a node. */
export function clear(node) {
    while (node.firstChild) node.firstChild.remove();
    return node;
}

/** SillyTavern's toast helper, with a console fallback. */
export function toast(kind, message) {
    const toastr = globalThis.toastr;
    if (toastr?.[kind]) toastr[kind](message);
    else console.log(`[PresetForge] ${kind}: ${message}`);
}

/** Yes/no dialog using SillyTavern's popup when available. */
export async function confirm(message) {
    try {
        const ctx = SillyTavern.getContext();
        const result = await ctx.callGenericPopup(message, ctx.POPUP_TYPE.CONFIRM);
        return result === ctx.POPUP_RESULT.AFFIRMATIVE || result === true;
    } catch {
        return globalThis.confirm(message);
    }
}
