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
 * just below the main nav; background color varies by `section`, so
 * each area of the app still reads as visually distinct even though
 * every one of them now shares the exact same header structure). Every
 * panel is expected to render exactly one of these, as its own first
 * element.
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
