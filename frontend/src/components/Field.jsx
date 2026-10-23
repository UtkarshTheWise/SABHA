/**
 * A labelled form control with one line reserved for its help or its error, so the
 * layout does not move when a message appears. The control is passed the props it
 * needs to be described to a screen reader; an error replaces the help in the
 * same line and sets aria-invalid.
 */
export default function Field({ id, label, help, error, required = false, requiredWord, children }) {
  const messageId = `${id}-message`;
  const describedBy = help || error ? messageId : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && requiredWord && <span className="field__required"> ({requiredWord})</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? "true" : undefined, "aria-required": required || undefined })}
      <p className={error ? "field__message field__message--error" : "field__message"} id={messageId} aria-live="polite">
        {error || help || ""}
      </p>
    </div>
  );
}
