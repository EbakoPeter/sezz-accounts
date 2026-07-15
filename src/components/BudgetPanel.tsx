import { Fragment, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { budgetCategoriesRepository, budgetSubcategoriesRepository } from "@/repositories";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { formatFcfa } from "@/lib/money";

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function BudgetPanel() {
  const [{ year, month }, setPeriod] = useState(currentYearMonth());
  const summary = useBudgetSummary(year, month);
  const categories = useLiveQuery(() => budgetCategoriesRepository.list(), []);

  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [subCategoryId, setSubCategoryId] = useState("");
  const [subName, setSubName] = useState("");
  const [subAllocation, setSubAllocation] = useState("0");
  const [subError, setSubError] = useState<string | null>(null);

  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function handleCreateCategory(event: FormEvent) {
    event.preventDefault();
    setCategoryError(null);
    try {
      await budgetCategoriesRepository.create({ name: categoryName });
      setCategoryName("");
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleCreateSubcategory(event: FormEvent) {
    event.preventDefault();
    setSubError(null);
    try {
      await budgetSubcategoriesRepository.create({
        categoryId: subCategoryId,
        name: subName,
        monthlyAllocation: Number(subAllocation),
      });
      setSubName("");
      setSubAllocation("0");
    } catch (error) {
      setSubError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleAllocationChange(subcategoryId: string, value: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return;
    try {
      await budgetSubcategoriesRepository.update(subcategoryId, { monthlyAllocation: amount });
    } catch (error) {
      setRowError({
        id: subcategoryId,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  async function handleDeleteCategory(id: string) {
    setRowError(null);
    try {
      await budgetCategoriesRepository.remove(id);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleDeleteSubcategory(id: string) {
    setRowError(null);
    try {
      await budgetSubcategoriesRepository.remove(id);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <section aria-labelledby="budget-heading">
      <h2 id="budget-heading">Budget Prévisionnel</h2>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="budget-month">Mois analysé</label>
        <input
          id="budget-month"
          type="month"
          value={`${year}-${String(month).padStart(2, "0")}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            if (y && m) setPeriod({ year: y, month: m });
          }}
        />
        <span className="empty">{monthLabel}</span>
      </div>

      <form onSubmit={handleCreateCategory} aria-label="Ajouter une catégorie">
        <div className="field">
          <label htmlFor="cat-name">Nouvelle catégorie</label>
          <input
            id="cat-name"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Ex : Vie Courante"
          />
        </div>
        <button type="submit">+ Ajouter</button>
        {categoryError && (
          <p role="alert" className="form-error">
            {categoryError}
          </p>
        )}
      </form>

      {(categories?.length ?? 0) > 0 && (
        <form onSubmit={handleCreateSubcategory} aria-label="Ajouter une sous-catégorie">
          <div className="field">
            <label htmlFor="sub-category">Catégorie</label>
            <select
              id="sub-category"
              value={subCategoryId}
              onChange={(e) => setSubCategoryId(e.target.value)}
            >
              <option value="" disabled>
                Choisir…
              </option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sub-name">Sous-catégorie</label>
            <input id="sub-name" value={subName} onChange={(e) => setSubName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sub-allocation">Budget mensuel</label>
            <input
              id="sub-allocation"
              type="number"
              value={subAllocation}
              onChange={(e) => setSubAllocation(e.target.value)}
            />
          </div>
          <button type="submit">+ Ajouter</button>
          {subError && (
            <p role="alert" className="form-error">
              {subError}
            </p>
          )}
        </form>
      )}

      {summary === undefined ? (
        <p>Chargement…</p>
      ) : summary.length === 0 ? (
        <p className="empty">Aucune catégorie budgétaire pour le moment.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Catégorie / Sous-catégorie</th>
              <th>Budget mensuel</th>
              <th>Réel</th>
              <th>Écart</th>
              <th>% utilisé</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {summary.map((category) => (
              <Fragment key={category.categoryId}>
                <tr style={{ fontWeight: 700 }}>
                  <td>{category.name}</td>
                  <td className="num">{formatFcfa(category.totalAllocation)}</td>
                  <td className="num">{formatFcfa(category.totalActual)}</td>
                  <td className={`num ${category.totalRemaining < 0 ? "negative" : ""}`}>
                    {formatFcfa(category.totalRemaining)}
                  </td>
                  <td />
                  <td>
                    <button type="button" onClick={() => handleDeleteCategory(category.categoryId)}>
                      Supprimer
                    </button>
                    {rowError?.id === category.categoryId && (
                      <p role="alert" className="form-error">
                        {rowError.message}
                      </p>
                    )}
                  </td>
                </tr>
                {category.subcategories.map((sub) => (
                  <tr key={sub.subcategoryId}>
                    <td style={{ paddingLeft: 24 }}>{sub.name}</td>
                    <td className="num">
                      <input
                        type="number"
                        defaultValue={sub.monthlyAllocation}
                        aria-label={`Budget mensuel de ${sub.name}`}
                        onBlur={(e) => handleAllocationChange(sub.subcategoryId, e.target.value)}
                        style={{ width: 100, textAlign: "right" }}
                      />
                    </td>
                    <td className="num">{formatFcfa(sub.actual)}</td>
                    <td className={`num ${sub.remaining < 0 ? "negative" : ""}`}>
                      {formatFcfa(sub.remaining)}
                    </td>
                    <td className={`num ${(sub.percentUsed ?? 0) > 100 ? "negative" : ""}`}>
                      {sub.percentUsed === null ? "—" : `${sub.percentUsed.toFixed(0)}%`}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDeleteSubcategory(sub.subcategoryId)}
                      >
                        Supprimer
                      </button>
                      {rowError?.id === sub.subcategoryId && (
                        <p role="alert" className="form-error">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
