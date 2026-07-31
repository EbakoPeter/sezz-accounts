import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { TRANSLATIONS, type Language } from "./translations";

const STORAGE_KEY = "lenkap-language";

/** Not a sensitive preference — deliberately plain localStorage rather
 * than anything going through this app's own encrypted local database,
 * consistent with how a language choice needs to be readable before any
 * user has even logged in (the login screen itself is translated). */
function detectInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "fr" || stored === "en") return stored;
  // No stored preference yet: French, this app's original, most
  // complete language and the one its actual current user base
  // overwhelmingly speaks — not a guess from the browser's own
  // language, which is both an unreliable signal for this app's
  // specific audience and, incidentally, would make a test
  // environment (which typically reports en-US) default every test to
  // English regardless of what a real first-time user here would see.
  return "fr";
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  /** `vars` fills in {placeholders} in the translated string — e.g.
   * t("home.welcome", { name: "Marie" }) → "Bienvenue, Marie !". A
   * missing key logs an error (so a translation gap is caught during
   * development, not silently shown as a raw key to a real user) and
   * falls back to French, then to the raw key itself if even that's
   * somehow missing, so the UI never ends up with an empty label. */
  t: (key: string, vars?: Record<string, string>) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => {
      let text = TRANSLATIONS[language][key];
      if (text === undefined) {
        console.error(`Traduction manquante pour la clé "${key}" (langue : ${language})`);
        text = TRANSLATIONS.fr[key] ?? key;
      }
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(`{${name}}`, value);
        }
      }
      return text;
    },
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return context;
}
