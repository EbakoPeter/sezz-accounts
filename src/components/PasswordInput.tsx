import { useId, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * A password `<input>` with a show/hide eye toggle button. Drop-in
 * replacement for `<input type="password" ... />` — every prop (id, value,
 * onChange, aria-label, ...) passes straight through, so an existing
 * `<label htmlFor="...">` still correctly targets the underlying input.
 *
 * Visibility is local, per-field state: toggling one password field's
 * visibility never affects any other field on the same screen.
 */
export function PasswordInput(props: Props) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const toggleId = `${props.id ?? generatedId}-toggle`;

  return (
    <div className="password-input">
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        id={toggleId}
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.05 3.9M6.5 6.7C4 8.3 2 12 2 12a15.6 15.6 0 0 0 5 5.6"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
