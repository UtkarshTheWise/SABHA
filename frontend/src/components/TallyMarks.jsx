/**
 * Counts drawn the way a returning officer draws them on paper: four uprights and
 * a stroke through for every five. This is the page's signature, the thing the
 * tool is known by, and it is always beside the figure it draws, never instead of
 * it, so it is hidden from screen readers (the number is the content).
 *
 * Beyond forty the bundles stop being readable, so the figure stands alone.
 */
const BUNDLE_W = 34;
const H = 26;

export default function TallyMarks({ count }) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0 || n > 40) return null;

  const bundles = Math.floor(n / 5);
  const remainder = n % 5;
  const groups = [...Array(bundles).fill(5), ...(remainder ? [remainder] : [])];
  const width = groups.length * BUNDLE_W;

  return (
    <svg className="tally-marks" width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true" focusable="false">
      {groups.map((size, g) => {
        const x0 = g * BUNDLE_W;
        const uprights = Math.min(size, 4);
        return (
          <g key={g}>
            {[...Array(uprights)].map((_, i) => (
              <line key={i} x1={x0 + 3 + i * 6} y1={3} x2={x0 + 5 + i * 6} y2={H - 3} />
            ))}
            {size === 5 && <line x1={x0} y1={H - 5} x2={x0 + 26} y2={5} />}
          </g>
        );
      })}
    </svg>
  );
}
