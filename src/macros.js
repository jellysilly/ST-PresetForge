/**
 * Macro shielding.
 *
 * SillyTavern runs substituteParams() over anything sent through generateRaw,
 * which would expand {{char}} in our own instructions and — worse — actually
 * execute {{setvar::...}} as a side effect, writing variables into the user's
 * chat. Rewriting an existing preset is the acute case: its modules are full of
 * macros that must reach the model untouched.
 *
 * So macros travel in a shielded notation that substituteParams does not match,
 * and are restored on the way back. The notation deliberately looks like the
 * real thing, which is enough for models to handle it without confusion.
 */

export const MACRO_OPEN = '{%';
export const MACRO_CLOSE = '%}';

/** Replace {{ }} with the shielded delimiters. */
export function shieldMacros(text) {
    return String(text ?? '')
        .replaceAll('{{', MACRO_OPEN)
        .replaceAll('}}', MACRO_CLOSE);
}

/** Restore real macro delimiters. Text the model wrote with {{ }} is left alone. */
export function unshieldMacros(text) {
    return String(text ?? '')
        .replaceAll(MACRO_OPEN, '{{')
        .replaceAll(MACRO_CLOSE, '}}');
}

/** The line that tells the model which delimiters to use. */
export function macroNotationNote() {
    return [
        `MACRO NOTATION: in this conversation macros are delimited ${MACRO_OPEN}like this${MACRO_CLOSE},`,
        'not with double braces. Read them that way and write them back exactly that way.',
        `For example ${MACRO_OPEN}char${MACRO_CLOSE}, ${MACRO_OPEN}user${MACRO_CLOSE},`,
        `${MACRO_OPEN}setvar::name::value${MACRO_CLOSE}${MACRO_OPEN}trim${MACRO_CLOSE}.`,
        'The delimiters are converted back after you reply.',
    ].join('\n');
}
