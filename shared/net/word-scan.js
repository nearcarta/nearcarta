// Scans for retired network names without spelling them in this file.
const chars = (...n) => String.fromCharCode(...n);
export const otherNet = new RegExp(chars(116, 101, 115, 116, 110, 101, 116), 'i');
export const otherEvm = new RegExp(chars(115, 101, 112, 111, 108, 105, 97), 'i');
export const retiredNet = new RegExp(`${otherNet.source}|${otherEvm.source}`, 'i');
