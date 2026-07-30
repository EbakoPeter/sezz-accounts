export type PageSection =
  | "home"
  | "accounts"
  | "operations"
  | "budget"
  | "debts"
  | "reports"
  | "recommendations"
  | "users"
  | "sync";

/**
 * The one page title every panel uses instead of writing its own <h2> —
 * see .page-header in App.css for the actual styling (centered,
 * uppercase via CSS text-transform rather than uppercasing the string
 * itself, so a screen reader still hears "Engagement" rather than
 * spelling out "E-N-G-A-G-E-M-E-N-T" as if it were an acronym; sticky
 * just below the main nav). Every header uses the same navy background
 * and gold title deliberately — one disciplined statement repeated
 * everywhere, not a different hue per section — matching the app's
 * "Executive Navy & Gold" direction. `section` is passed through as a
 * data-section attribute for anyone that wants to key off which page
 * this is (styling or otherwise), even though the current styling
 * itself no longer varies by it. Every panel is expected to render
 * exactly one of these, as its own first element.
 */
export function PageHeader({
  title,
  section,
  id,
}: {
  title: string;
  section: PageSection;
  id?: string;
}) {
  return (
    <div className="page-header" data-section={section}>
      <h2 id={id}>{title}</h2>
    </div>
  );
}
