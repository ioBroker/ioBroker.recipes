/**
 * The device types of @iobroker/type-detector and the states each of them knows.
 *
 * A recipe names device types in `deviceType` and reaches the states of a device with `{{name.STATE}}`.
 * Both are checked against the patterns of the type-detector, so that ioBroker.javascript can propose
 * the devices that fit.
 */
import { ChannelDetector } from '@iobroker/type-detector';

/** @type {Map<string, { states: Set<string>, required: Set<string> }>} */
export const DEVICE_TYPES = new Map();

for (const pattern of Object.values(ChannelDetector.getPatterns())) {
    let entry = DEVICE_TYPES.get(pattern.type);
    if (!entry) {
        entry = { states: new Set(), required: new Set() };
        DEVICE_TYPES.set(pattern.type, entry);
    }
    for (const state of pattern.states) {
        entry.states.add(state.name);
        if (state.required) {
            entry.required.add(state.name);
        }
    }
}

/** Distance of two texts, for "did you mean": letters added, removed, changed or swapped */
function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

/**
 * The known name closest to a wrong one, if there is a close one.
 *
 * @param {string} name the wrong name
 * @param {Iterable<string>} known the right ones
 */
export function closest(name, known) {
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of known) {
        const d = distance(name.toLowerCase(), candidate.toLowerCase());
        if (d < bestDistance) {
            best = candidate;
            bestDistance = d;
        }
    }
    // one mistake in a short name, one more per 4 letters
    return bestDistance <= Math.max(1, Math.floor(name.length / 4)) ? best : null;
}
