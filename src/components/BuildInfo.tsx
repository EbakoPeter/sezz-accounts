/** Shows exactly which build is running — see vite.config.ts for how
 * __BUILD_TIME__ is produced. Deliberately plain and unobtrusive, but
 * always present, on both the login screen and the error screen: the two
 * places where "am I actually looking at the latest deploy?" comes up. */
export function BuildInfo() {
  const formatted = new Date(__BUILD_TIME__).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
  return (
    <p style={{ fontSize: "0.7rem", color: "#726b5e", textAlign: "center", marginTop: 16 }}>
      Version du {formatted}
    </p>
  );
}
