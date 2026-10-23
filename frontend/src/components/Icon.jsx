/**
 * The page's small set of icons, drawn once and used everywhere. They are always
 * decoration: the word beside each one carries the meaning, so none is announced.
 */
const paths = {
  check: <path d="M4 10.5l4 4 8-9" />,
  alert: (
    <>
      <path d="M10 3.5l8 14H2z" />
      <path d="M10 9v4M10 15.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v5M10 6.2v.1" />
    </>
  ),
  copy: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7" />
    </>
  ),
  external: (
    <>
      <path d="M8 4H4.5A1.5 1.5 0 003 5.5v10A1.5 1.5 0 004.5 17h10a1.5 1.5 0 001.5-1.5V12" />
      <path d="M11 3h6v6M17 3l-8 8" />
    </>
  ),
  menu: <path d="M3 6h14M3 10h14M3 14h14" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </>
  ),
};

export default function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
