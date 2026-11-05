// One room at a time. A second pin during the door transition is ignored.

export function beginEnter(state, id) {
  if (!id || state?.busy) return { ...state, busy: true, id: state?.id || null, ignored: id };
  return { busy: true, id, ignored: null };
}

export function finishEnter(state) {
  return { busy: false, id: state?.id || null, ignored: null };
}
