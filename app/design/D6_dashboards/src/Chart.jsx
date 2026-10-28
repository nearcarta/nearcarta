import React, { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// Times are 28 Oct 2026 EEST wall-clock, encoded as if UTC so the axis reads local time.
export const ts = (hms) => { const [h, m, s = 0] = hms.split(':').map(Number); return Date.UTC(2026, 9, 28, h, m, s) / 1000; };

export default function SpendChart({ points, markers, budget, cap, height = 230 }) {
  const el = useRef(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const c = createChart(el.current, {
      height, autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: css('--c-text-3'), fontFamily: 'JetBrains Mono', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: css('--c-line') } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.04 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { vertLine: { color: css('--c-line-2'), labelBackgroundColor: css('--c-pane-3') }, horzLine: { color: css('--c-line-2'), labelBackgroundColor: css('--c-pane-3') } },
      handleScroll: false, handleScale: false,
    });
    const area = c.addAreaSeries({
      lineColor: css('--c-chart-line'), lineWidth: 2, lineType: 1,
      topColor: theme === 'light' ? 'rgba(24,25,27,.10)' : 'rgba(237,237,239,.12)', bottomColor: 'rgba(0,0,0,0)',
      priceFormat: { type: 'custom', formatter: (v) => v.toFixed(2) }, lastValueVisible: false, priceLineVisible: false,
    });
    area.setData(points);
    area.createPriceLine({ price: budget, color: css('--c-crit'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'daily budget' });
    if (markers) area.setMarkers(markers.map((m) => ({ ...m, color: m.tone === 'pos' ? css('--c-pos') : css('--c-crit') })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [theme, points, markers, budget, cap, height]);
  return <div ref={el} style={{ height, width: '100%' }} />;
}
