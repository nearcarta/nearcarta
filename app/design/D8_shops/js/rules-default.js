// The rules a new visitor starts with (Toll/pay clause). The tray chip says when the live cap differs.
export const DEFAULT_RULES = { cap: 0.05, budget: 0.2, count: 10, min: 0.001, ferryCap: 0.1 };

// Chip text for the "Your rules" button. capNear: the live per-action cap in NEAR, or null with no pay clause.
export function ruleChip(capNear, fmt = n => `${n} NEAR`) {
  if (capNear == null || !Number.isFinite(capNear)) return { text: 'Your rules', changed: false, title: '' };
  const changed = Math.abs(capNear - DEFAULT_RULES.cap) > 1e-9;
  return {
    text: `Your rules · max per payment ${fmt(capNear)}${changed ? ' · changed in Town Hall' : ''}`,
    changed,
    title: changed ? `The default cap is ${fmt(DEFAULT_RULES.cap)}. Yours was changed by a Town Hall vote or in Your rules.` : `The default cap (${fmt(DEFAULT_RULES.cap)}).`,
  };
}
