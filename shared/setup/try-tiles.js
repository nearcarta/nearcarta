// Step 7 of setup. The pass tile must not be offered when the row has no payments left today.
export function tryTiles({ actionsToday = 0, maxPerDay = 3, lowBalance = false } = {}) {
  const used = Math.max(0, Number(actionsToday) || 0);
  const max = Math.max(0, Number(maxPerDay) || 0);
  const left = Math.max(0, max - used);
  const noneLeft = left < 1;
  const reason = noneLeft
    ? `0 of ${max} left today. The count resets at the next UTC day. Nothing will be sent.`
    : lowBalance
      ? 'Needs charter balance: add NEAR below first'
      : `${left} of ${max} left today. Inside your rule: should pass`;
  return {
    left,
    max,
    allowDisabled: noneLeft || lowBalance,
    allowReason: reason,
    refuseDisabled: lowBalance,
    refuseReason: lowBalance ? 'Needs charter balance: add NEAR below first' : 'Twice your cap: should be refused',
    allowAction: noneLeft || lowBalance ? reason : 'Tap to run →',
    refuseAction: lowBalance ? 'Needs charter balance: add NEAR below first' : 'Tap to run →',
  };
}
