/**
 * Tolerant JSON extraction for model output.
 *
 * Models wrap JSON in prose, in ``` fences, emit trailing commas, use smart
 * quotes and — most often — put raw newlines inside string literals. Every one
 * of those is recoverable, so we repair rather than fail.
 */

/** Strip ``` fences and any prose before/after them. */
function stripFences(text) {
    const fence = /```(?:json|JSON|json5)?\s*([\s\S]*?)```/g;
    const blocks = [...text.matchAll(fence)].map(m => m[1].trim()).filter(Boolean);
    if (blocks.length) {
        // The largest block is almost always the payload.
        return blocks.sort((a, b) => b.length - a.length)[0];
    }
    return text;
}

/**
 * Slice out the outermost balanced {...} or [...] region, ignoring braces that
 * live inside string literals.
 */
function sliceBalanced(text) {
    const startIdx = (() => {
        const brace = text.indexOf('{');
        const bracket = text.indexOf('[');
        if (brace === -1) return bracket;
        if (bracket === -1) return brace;
        return Math.min(brace, bracket);
    })();
    if (startIdx === -1) return null;

    const open = text[startIdx];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(startIdx, i + 1);
        }
    }
    // Unterminated: hand back the remainder so the repair pass can close it.
    return text.slice(startIdx);
}

/** Normalise the quote and dash characters models like to smuggle in. */
function normaliseQuotes(text) {
    return text
        .replace(/[“”„‟]/g, '"')
        .replace(/[‘’‚‛]/g, "'")
        .replace(/﻿/g, '');
}

/**
 * Escape raw control characters that appear inside string literals, and drop
 * trailing commas. Walks the text once, tracking string state.
 */
function repairStrings(text) {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escaped) {
            // Keep only escapes JSON actually understands.
            out += '"\\/bfnrtu'.includes(ch) ? '\\' + ch : ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            if (inString) { escaped = true; continue; }
            out += ch;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            out += ch;
            continue;
        }
        if (inString) {
            if (ch === '\n') out += '\\n';
            else if (ch === '\r') out += '\\r';
            else if (ch === '\t') out += '\\t';
            else if (ch < ' ') out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
            else out += ch;
            continue;
        }
        out += ch;
    }

    // Trailing commas before a closer, now that we know we are outside strings.
    return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Close any structures the model left dangling. */
function closeDangling(text) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
    }

    let out = text;
    if (inString) out += '"';
    // Drop a dangling comma or key fragment before closing.
    out = out.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:\s*$/, '');
    while (stack.length) {
        out += stack.pop() === '{' ? '}' : ']';
    }
    return out;
}

/**
 * Parse model output into an object, repairing as needed.
 * @param {string} raw
 * @returns {any}
 * @throws {Error} when nothing salvageable is present
 */
export function parseModelJson(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new Error('Empty response');
    }

    const candidates = [];
    const fenced = stripFences(normaliseQuotes(raw));
    candidates.push(fenced);
    const sliced = sliceBalanced(fenced);
    if (sliced) candidates.push(sliced);

    for (const candidate of candidates) {
        for (const attempt of [candidate, repairStrings(candidate), closeDangling(repairStrings(candidate))]) {
            try {
                const parsed = JSON.parse(attempt);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch {
                // try the next repair level
            }
        }
    }

    throw new Error('No parsable JSON in response');
}

/**
 * Parse and pull out an array that may be at the root or under a known key.
 * @param {string} raw
 * @param {string[]} keys
 * @returns {any[]}
 */
export function parseModelArray(raw, keys) {
    const parsed = parseModelJson(raw);
    if (Array.isArray(parsed)) return parsed;
    for (const key of keys) {
        if (Array.isArray(parsed?.[key])) return parsed[key];
    }
    // Last resort: the first array-valued property.
    for (const value of Object.values(parsed ?? {})) {
        if (Array.isArray(value)) return value;
    }
    throw new Error('Response contained no array');
}
