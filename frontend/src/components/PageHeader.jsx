import { useRouteFocus } from "../router.jsx";

/**
 * The top of every page. The heading takes focus when the page changes, so a
 * keyboard or screen-reader user arrives at the start of the new page, and the tab
 * title follows it.
 */
export default function PageHeader({ title, lede, children }) {
  useRouteFocus(typeof title === "string" ? title : undefined);
  return (
    <header className="page-head">
      <h1 id="page-title" tabIndex={-1} dir="auto">
        {title}
      </h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}
