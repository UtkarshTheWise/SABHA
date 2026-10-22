/**
 * Counts drawn the way a returning officer draws them on paper: four uprights
 * and a stroke through for every five. Beyond forty marks the bundles stop
 * being readable, so we switch to a plain numeral.
 */
const BUNDLE_W = 34;
const H = 26;

export default function TallyMarks({ count, leading }) {
  const n = Number(count);
  if (n === 0) return <span className="tally-zero">no votes yet</span>;
  if (n > 40) return <span className="tally-numeric">{n}</span>;

  const bundles = Math.floor(n / 5);
  const remainder = n % 5;
  const groups = [...Array(bundles).fill(5), ...(remainder ? [remainder] : [])];
  const width = groups.length * BUNDLE_W;

  return (
    <svg
      className={leading ? "tally leading" : "tally"}
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      role="img"
      aria-label={`${n} ${n === 1 ? "vote" : "votes"}`}
    >
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
