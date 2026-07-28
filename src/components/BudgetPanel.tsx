import { Fragment, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  budgetCategoriesRepository,
  budgetSubcategoriesRepository,
  engagementsRepository,
} from "@/repositories";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { useAuth } from "@/auth/AuthContext";
import { formatFcfa } from "@/lib/money";
import type { EngagementStatus } from "@/types/models";
import { PageHeader } from "./PageHeader";

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function BudgetPanel({ view = "both" }: { view?: "forecast" | "engagements" | "both" }) {
  const [{ year, month }, setPeriod] = useState(currentYearMonth());
  const summary = useBudgetSummary(year, month);
  const categories = useLiveQuery(() => budgetCategoriesRepository.list(), []);
  const { currentUser } = useAuth();
  const canManage = currentUser?.permissions.manageBudget ?? false;

  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [subCategoryId, setSubCategoryId] = useState("");
  const [subName, setSubName] = useState("");
  const [subAllocation, setSubAllocation] = useState("0");
  const [subError, setSubError] = useState<string | null>(null);

  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  const [editingSubcategoryId, setEditingSubcategoryId] = useState<string | null>(null);
  const [editSubcategoryName, setEditSubcategoryName] = useState("");
  const [editSubcategoryAllocation, setEditSubcategoryAllocation] = useState("");

  const engagements = useLiveQuery(
    () => engagementsRepository.list({ year, month }),
    [year, month],
  );
  const [engagementSubcategoryId, setEngagementSubcategoryId] = useState("");
  const [engagementAmount, setEngagementAmount] = useState("");
  const [engagementLabel, setEngagementLabel] = useState("");
  const [engagementDate, setEngagementDate] = useState(
    `${year}-${String(month).padStart(2, "0")}-01`,
  );
  const [engagementError, setEngagementError] = useState<string | null>(null);

  const [editingEngagementId, setEditingEngagementId] = useState<string | null>(null);
  const [editEngagementSubcategoryId, setEditEngagementSubcategoryId] = useState("");
  const [editEngagementAmount, setEditEngagementAmount] = useState("");
  const [editEngagementLabel, setEditEngagementLabel] = useState("");
  const [editEngagementDate, setEditEngagementDate] = useState("");
  const [engagementRowError, setEngagementRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);

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

  async function handleDeleteCategory(id: string) {
    if (
      !window.confirm(
        "Voulez-vous vraiment supprimer cette catégorie ? Cette action est irréversible.",
      )
    ) {
      return;
    }
    setRowError(null);
    try {
      await budgetCategoriesRepository.remove(id);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleDeleteSubcategory(id: string) {
    if (
      !window.confirm(
        "Voulez-vous vraiment supprimer cette sous-catégorie ? Cette action est irréversible.",
      )
    ) {
      return;
    }
    setRowError(null);
    try {
      await budgetSubcategoriesRepository.remove(id);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  function handleStartEditCategory(category: { categoryId: string; name: string }) {
    setRowError(null);
    setEditingCategoryId(category.categoryId);
    setEditCategoryName(category.name);
  }

  function handleCancelEditCategory() {
    setEditingCategoryId(null);
  }

  async function handleSaveEditCategory(id: string) {
    setRowError(null);
    try {
      await budgetCategoriesRepository.update(id, { name: editCategoryName });
      setEditingCategoryId(null);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  function handleStartEditSubcategory(sub: {
    subcategoryId: string;
    name: string;
    monthlyAllocation: number;
  }) {
    setRowError(null);
    setEditingSubcategoryId(sub.subcategoryId);
    setEditSubcategoryName(sub.name);
    setEditSubcategoryAllocation(String(sub.monthlyAllocation));
  }

  function handleCancelEditSubcategory() {
    setEditingSubcategoryId(null);
  }

  async function handleSaveEditSubcategory(id: string) {
    setRowError(null);
    try {
      await budgetSubcategoriesRepository.update(id, {
        name: editSubcategoryName,
        monthlyAllocation: Number(editSubcategoryAllocation),
      });
      setEditingSubcategoryId(null);
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Erreur inattendue." });
    }
  }

  async function handleCreateEngagement(event: FormEvent) {
    event.preventDefault();
    setEngagementError(null);
    try {
      await engagementsRepository.create({
        subcategoryId: engagementSubcategoryId,
        amount: Number(engagementAmount),
        label: engagementLabel,
        date: engagementDate,
      });
      setEngagementAmount("");
      setEngagementLabel("");
    } catch (error) {
      setEngagementError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleDeleteEngagement(id: string) {
    if (
      !window.confirm(
        "Voulez-vous vraiment supprimer cet engagement ? Cette action est irréversible.",
      )
    ) {
      return;
    }
    setEngagementRowError(null);
    try {
      await engagementsRepository.remove(id);
    } catch (error) {
      setEngagementRowError({
        id,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  function handleStartEditEngagement(engagement: {
    id: string;
    subcategoryId: string;
    amount: number;
    label: string;
    date: string;
  }) {
    setEngagementRowError(null);
    setEditingEngagementId(engagement.id);
    setEditEngagementSubcategoryId(engagement.subcategoryId);
    setEditEngagementAmount(String(engagement.amount));
    setEditEngagementLabel(engagement.label);
    setEditEngagementDate(engagement.date);
  }

  function handleCancelEditEngagement() {
    setEditingEngagementId(null);
  }

  async function handleSaveEditEngagement(id: string) {
    setEngagementRowError(null);
    try {
      await engagementsRepository.update(id, {
        subcategoryId: editEngagementSubcategoryId,
        amount: Number(editEngagementAmount),
        label: editEngagementLabel,
        date: editEngagementDate,
      });
      setEditingEngagementId(null);
    } catch (error) {
      setEngagementRowError({
        id,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  const STATUS_LABELS: Record<EngagementStatus, string> = {
    engaged: "Engagé",
    realized: "Réalisé",
    cancelled: "Annulé",
  };

  const allSubcategories = (summary ?? []).flatMap((c) => c.subcategories);
  const subcategoryNameById = new Map(allSubcategories.map((s) => [s.subcategoryId, s.name]));

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const pageTitle =
    view === "engagements" ? "Engagement" : view === "forecast" ? "Budget Prévisionnel" : "Budget";

  return (
    <section aria-labelledby="budget-heading">
      <PageHeader title={pageTitle} section="budget" id="budget-heading" />

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

      {(view === "forecast" || view === "both") &&
        (!canManage ? (
          <p className="permission-notice">
            Vous n&apos;avez pas la permission de modifier le budget prévisionnel.
          </p>
        ) : (
          <div className="budget-entry-section">
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
                  <input
                    id="sub-name"
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                  />
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
          </div>
        ))}

      {(view === "forecast" || view === "both") &&
        (summary === undefined ? (
          <p>Chargement…</p>
        ) : summary.length === 0 ? (
          <p className="empty">Aucune catégorie budgétaire pour le moment.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Catégorie / Sous-catégorie</th>
                  <th>Budget mensuel</th>
                  <th>Réel</th>
                  <th>Engagé</th>
                  <th>Écart</th>
                  <th>% utilisé</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.map((category) => (
                  <Fragment key={category.categoryId}>
                    <tr style={{ fontWeight: 700 }}>
                      <td>
                        {editingCategoryId === category.categoryId ? (
                          <input
                            aria-label={`Nom de ${category.name}`}
                            value={editCategoryName}
                            onChange={(e) => setEditCategoryName(e.target.value)}
                          />
                        ) : (
                          category.name
                        )}
                      </td>
                      <td className="num">{formatFcfa(category.totalAllocation)}</td>
                      <td className="num">{formatFcfa(category.totalActual)}</td>
                      <td className="num">{formatFcfa(category.totalEngaged)}</td>
                      <td className={`num ${category.totalRemaining < 0 ? "negative" : ""}`}>
                        {formatFcfa(category.totalRemaining)}
                      </td>
                      <td />
                      <td>
                        {canManage &&
                          (editingCategoryId === category.categoryId ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSaveEditCategory(category.categoryId)}
                              >
                                Enregistrer
                              </button>{" "}
                              <button
                                type="button"
                                className="ghost"
                                onClick={handleCancelEditCategory}
                              >
                                Annuler
                              </button>
                            </>
                          ) : (
                            <span className="row-actions">
                              <button
                                type="button"
                                onClick={() => handleStartEditCategory(category)}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCategory(category.categoryId)}
                              >
                                Supprimer
                              </button>
                            </span>
                          ))}
                        {rowError?.id === category.categoryId && (
                          <p role="alert" className="form-error">
                            {rowError.message}
                          </p>
                        )}
                      </td>
                    </tr>
                    {category.subcategories.map((sub) => (
                      <tr key={sub.subcategoryId}>
                        <td style={{ paddingLeft: 24 }}>
                          {editingSubcategoryId === sub.subcategoryId ? (
                            <input
                              aria-label={`Nom de ${sub.name}`}
                              value={editSubcategoryName}
                              onChange={(e) => setEditSubcategoryName(e.target.value)}
                            />
                          ) : (
                            sub.name
                          )}
                        </td>
                        <td className="num">
                          {sub.autoAllocatedFromDebts ? (
                            <span
                              className="computed"
                              title="Calculé automatiquement à partir des mensualités prévisionnelles des dettes en cours."
                            >
                              {formatFcfa(sub.monthlyAllocation)}{" "}
                              <span className="empty">(auto)</span>
                            </span>
                          ) : editingSubcategoryId === sub.subcategoryId ? (
                            <input
                              type="number"
                              value={editSubcategoryAllocation}
                              aria-label={`Budget mensuel de ${sub.name}`}
                              onChange={(e) => setEditSubcategoryAllocation(e.target.value)}
                              style={{ width: 100, textAlign: "right" }}
                            />
                          ) : (
                            formatFcfa(sub.monthlyAllocation)
                          )}
                        </td>
                        <td className="num computed">{formatFcfa(sub.actual)}</td>
                        <td className="num computed">{formatFcfa(sub.engaged)}</td>
                        <td className={`num computed ${sub.remaining < 0 ? "negative" : ""}`}>
                          {formatFcfa(sub.remaining)}
                        </td>
                        <td
                          className={`num computed ${(sub.percentUsed ?? 0) > 100 ? "negative" : ""}`}
                        >
                          {sub.percentUsed === null ? "—" : `${sub.percentUsed.toFixed(0)}%`}
                        </td>
                        <td>
                          {canManage &&
                            (editingSubcategoryId === sub.subcategoryId ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditSubcategory(sub.subcategoryId)}
                                >
                                  Enregistrer
                                </button>{" "}
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={handleCancelEditSubcategory}
                                >
                                  Annuler
                                </button>
                              </>
                            ) : (
                              <span className="row-actions">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditSubcategory(sub)}
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSubcategory(sub.subcategoryId)}
                                >
                                  Supprimer
                                </button>
                              </span>
                            ))}
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
          </div>
        ))}

      {(view === "engagements" || view === "both") &&
        ((canManage && allSubcategories.length > 0) || (engagements?.length ?? 0) > 0) && (
          <section className="accent-sage" aria-labelledby="engagements-heading">
            <h3 id="engagements-heading">Engagements sur le budget</h3>
            {canManage && allSubcategories.length > 0 && (
              <>
                <p className="tagline">
                  Réservez une partie du budget pour une dépense prévue mais pas encore payée — elle
                  se déduit du solde disponible sans apparaître comme dépense tant qu&apos;aucune
                  opération n&apos;est créée.
                </p>
                <form onSubmit={handleCreateEngagement} aria-label="Ajouter un engagement">
                  <div className="field">
                    <label htmlFor="engagement-subcategory">Ligne budgétaire</label>
                    <select
                      id="engagement-subcategory"
                      value={engagementSubcategoryId}
                      onChange={(e) => setEngagementSubcategoryId(e.target.value)}
                    >
                      <option value="" disabled>
                        Choisir…
                      </option>
                      {(summary ?? []).map((category) => (
                        <optgroup key={category.categoryId} label={category.name}>
                          {category.subcategories.map((sub) => (
                            <option key={sub.subcategoryId} value={sub.subcategoryId}>
                              {sub.name} — Restant : {formatFcfa(sub.remaining)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="engagement-amount">Montant</label>
                    <input
                      id="engagement-amount"
                      type="number"
                      value={engagementAmount}
                      onChange={(e) => setEngagementAmount(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="engagement-label">Libellé</label>
                    <input
                      id="engagement-label"
                      value={engagementLabel}
                      onChange={(e) => setEngagementLabel(e.target.value)}
                      placeholder="Ex : Frais de scolarité"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="engagement-date">Date</label>
                    <input
                      id="engagement-date"
                      type="date"
                      value={engagementDate}
                      onChange={(e) => setEngagementDate(e.target.value)}
                    />
                  </div>
                  <button type="submit">+ Ajouter</button>
                  {engagementError && (
                    <p role="alert" className="form-error">
                      {engagementError}
                    </p>
                  )}
                </form>
              </>
            )}

            {(engagements?.length ?? 0) > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Ligne budgétaire</th>
                      <th>Libellé</th>
                      <th>Montant</th>
                      <th>Statut</th>
                      <th>Payé</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {engagements?.map((engagement) =>
                      editingEngagementId === engagement.id ? (
                        <tr key={engagement.id}>
                          <td>
                            <input
                              aria-label={`Date de l'engagement ${engagement.label}`}
                              type="date"
                              value={editEngagementDate}
                              onChange={(e) => setEditEngagementDate(e.target.value)}
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`Ligne budgétaire de l'engagement ${engagement.label}`}
                              value={editEngagementSubcategoryId}
                              onChange={(e) => setEditEngagementSubcategoryId(e.target.value)}
                            >
                              {(summary ?? []).map((category) => (
                                <optgroup key={category.categoryId} label={category.name}>
                                  {category.subcategories.map((sub) => (
                                    <option key={sub.subcategoryId} value={sub.subcategoryId}>
                                      {sub.name} — Restant : {formatFcfa(sub.remaining)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              aria-label={`Libellé de l'engagement ${engagement.label}`}
                              value={editEngagementLabel}
                              onChange={(e) => setEditEngagementLabel(e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Montant de l'engagement ${engagement.label}`}
                              type="number"
                              value={editEngagementAmount}
                              onChange={(e) => setEditEngagementAmount(e.target.value)}
                            />
                          </td>
                          <td>{STATUS_LABELS[engagement.status]}</td>
                          <td>{engagement.status === "realized" ? "Oui" : "Non"}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleSaveEditEngagement(engagement.id)}
                            >
                              Enregistrer
                            </button>{" "}
                            <button
                              type="button"
                              className="ghost"
                              onClick={handleCancelEditEngagement}
                            >
                              Annuler
                            </button>
                            {engagementRowError?.id === engagement.id && (
                              <p role="alert" className="form-error">
                                {engagementRowError.message}
                              </p>
                            )}
                          </td>
                        </tr>
                      ) : (
                        <tr key={engagement.id}>
                          <td>{engagement.date}</td>
                          <td>{subcategoryNameById.get(engagement.subcategoryId) ?? "—"}</td>
                          <td className="truncate">{engagement.label}</td>
                          <td className="num">{formatFcfa(engagement.amount)}</td>
                          <td>{STATUS_LABELS[engagement.status]}</td>
                          <td>{engagement.status === "realized" ? "Oui" : "Non"}</td>
                          <td>
                            {canManage && (
                              <span className="row-actions">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditEngagement(engagement)}
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEngagement(engagement.id)}
                                >
                                  Supprimer
                                </button>
                              </span>
                            )}
                            {engagementRowError?.id === engagement.id && (
                              <p role="alert" className="form-error">
                                {engagementRowError.message}
                              </p>
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
    </section>
  );
}
