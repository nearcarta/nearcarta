// Every charter factory a guest's house can live in: the current one first, then the older releases from
// shared/deployments (vault.legacy). Pure, so the House page and its tests share it.
export function factoriesOf(vault, fallback) {
  const all = [vault?.factory || fallback, ...(vault?.legacy || []).map(l => l?.factory)];
  return [...new Set(all.filter(f => typeof f === 'string' && f))];
}
/** charters_of on every factory; a factory that fails to answer counts as no deeds there. Newest factory first, no duplicates. */
export async function deedsOn(factories, view, owner) {
  const lists = await Promise.all(factories.map(f => Promise.resolve().then(() => view(f, 'charters_of', { owner })).catch(() => [])));
  return [...new Set(lists.flatMap(l => (Array.isArray(l) ? l : []).filter(x => typeof x === 'string')))];
}
/** The factory a charter account was made by: a charter is always a direct sub-account of its factory. */
export const factoryOfCharter = id => String(id).split('.').slice(1).join('.');
