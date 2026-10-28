// D7 number ticker: digits roll like an odometer. Own code; the idea came from Kinetics (kinetics.colorion.co).
export function ticker(el, value = 0, { decimals = 2, prefix = '', suffix = '' } = {}) {
  el.classList.add('d7-num'); el.setAttribute('aria-live', 'polite');
  let cur = null;
  function set(v) {
    const s = prefix + Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (cur === null || cur.length !== s.length) {
      el.innerHTML = [...s].map(ch => /\d/.test(ch) ? `<span class="col"><span>${[0,1,2,3,4,5,6,7,8,9].map(d => `<i>${d}</i>`).join('')}</span></span>` : `<span>${ch}</span>`).join('');
    }
    [...el.children].forEach((c, i) => { if (c.classList.contains('col')) c.firstChild.style.transform = `translateY(${-(+s[i])}em)`; });
    el.setAttribute('aria-label', s); cur = s;
  }
  set(value); return { set, get value() { return cur; } };
}
