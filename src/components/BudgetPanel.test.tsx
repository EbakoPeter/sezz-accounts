import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./BudgetPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { fromStorageRow } from "@/db/encryptedRecord";
import { encryptedFixture } from "@/test/encryptedFixture";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";
import type { BudgetSubcategory, Transaction, Engagement } from "@/types/models";

afterEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
  await db.transactions.clear();
  await db.engagements.clear();
  await db.budgetSubcategories.clear();
  await db.budgetCategories.clear();
  await db.accounts.clear();
  clearActiveDek();
  vi.restoreAllMocks();
});

// Deletion now asks for confirmation first — defaults to "confirmed" so
// every existing test that expects a delete to actually happen doesn't
// need to know about this dialog. Tests specifically covering the
// "cancelled" path override this per-test.
beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("BudgetPanel", () => {
  it("shows an empty state with no categories", async () => {
    await renderAuthenticated(<BudgetPanel />);
    expect(await screen.findByText(/aucune catégorie/i)).toBeInTheDocument();
  });

  it("creates a category through the form", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Vie Courante");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);

    expect(await screen.findByText("Vie Courante")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting a category, and does not delete when cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await renderAuthenticated(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "À Garder");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);
    const table = await screen.findByRole("table");
    await within(table).findByText("À Garder");

    await user.click(within(table).getByRole("button", { name: /supprimer/i }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(within(table).getByText("À Garder")).toBeInTheDocument();
  });

  it("rejects a duplicate category name inline", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Logement");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);
    await waitFor(() => expect(screen.getByLabelText(/nouvelle catégorie/i)).toHaveValue(""));

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Logement");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(/existe déjà/i);
  });

  it("creates a subcategory once a category exists, and shows it under that category", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Vie Courante");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);
    await screen.findByText("Vie Courante");

    await user.selectOptions(screen.getByLabelText(/^catégorie$/i), "Vie Courante");
    await user.type(screen.getByLabelText(/^sous-catégorie$/i), "Transport");
    const allocationInput = screen.getByLabelText(/budget mensuel$/i);
    await user.clear(allocationInput);
    await user.type(allocationInput, "25000");
    await user.click(screen.getAllByRole("button", { name: /\+ ajouter/i })[1]!);

    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Transport")).toBeInTheDocument();
  });

  it("updates an allocation inline and reflects it live", async () => {
    const session = await createTestUser("admin");
    await db.budgetCategories.add(
      await encryptedFixture(
        { id: "cat-1", name: "Vie Courante", createdAt: Date.now(), updatedAt: Date.now() },
        ["name"] as const,
      ),
    );
    await db.budgetSubcategories.add(
      await encryptedFixture(
        {
          id: "sub-1",
          categoryId: "cat-1",
          name: "Transport",
          monthlyAllocation: 10000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["name", "monthlyAllocation"] as const,
      ),
    );

    const user = userEvent.setup();
    renderWithSession(<BudgetPanel />, session);

    const input = await screen.findByLabelText("Budget mensuel de Transport");
    expect(input).toHaveValue(10000);
    await user.clear(input);
    await user.type(input, "30000");
    await user.tab(); // triggers onBlur

    await waitFor(async () => {
      const row = await db.budgetSubcategories.get("sub-1");
      const updated = row && (await fromStorageRow<BudgetSubcategory>(row));
      expect(updated?.monthlyAllocation).toBe(30000);
    });
  });

  it("blocks deleting a subcategory still referenced by a transaction", async () => {
    const session = await createTestUser("admin");
    await db.accounts.add(
      await encryptedFixture(
        {
          id: "acc-1",
          name: "Compte",
          initialBalance: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["name", "initialBalance"] as const,
      ),
    );
    await db.budgetCategories.add(
      await encryptedFixture(
        { id: "cat-1", name: "Vie Courante", createdAt: Date.now(), updatedAt: Date.now() },
        ["name"] as const,
      ),
    );
    await db.budgetSubcategories.add(
      await encryptedFixture(
        {
          id: "sub-1",
          categoryId: "cat-1",
          name: "Transport",
          monthlyAllocation: 10000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["name", "monthlyAllocation"] as const,
      ),
    );
    await db.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: "tx-1",
          accountId: "acc-1",
          kind: "expense",
          date: "2020-01-01",
          label: "Vieux",
          amount: 100,
          subcategoryId: "sub-1",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["label", "amount", "note"] as const,
      ),
    );

    const user = userEvent.setup();
    renderWithSession(<BudgetPanel />, session);

    const table = await screen.findByRole("table");
    within(table).getByText("Transport");
    const deleteButtons = await screen.findAllByRole("button", { name: /supprimer/i });
    // first Supprimer is the category row's, second is the subcategory's
    await user.click(deleteButtons[1]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(/opération/i);
    expect(within(table).getByText("Transport")).toBeInTheDocument();
  });

  describe("editing names", () => {
    it("edits a category's name", async () => {
      const session = await createTestUser("admin");
      await db.budgetCategories.add(
        await encryptedFixture(
          { id: "cat-1", name: "Avant", createdAt: Date.now(), updatedAt: Date.now() },
          ["name"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      await user.click(await screen.findByRole("button", { name: /^modifier$/i }));
      const nameInput = screen.getByLabelText("Nom de Avant");
      await user.clear(nameInput);
      await user.type(nameInput, "Après");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        expect(screen.getByText("Après")).toBeInTheDocument();
      });
      expect(screen.queryByText("Avant")).not.toBeInTheDocument();
    });

    it("edits a subcategory's name", async () => {
      const session = await createTestUser("admin");
      await db.budgetCategories.add(
        await encryptedFixture(
          { id: "cat-1", name: "Vie Courante", createdAt: Date.now(), updatedAt: Date.now() },
          ["name"] as const,
        ),
      );
      await db.budgetSubcategories.add(
        await encryptedFixture(
          {
            id: "sub-1",
            categoryId: "cat-1",
            name: "Avant",
            monthlyAllocation: 10000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["name", "monthlyAllocation"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      const modifierButtons = await screen.findAllByRole("button", { name: /^modifier$/i });
      // first Modifier is the category row's, second is the subcategory's
      await user.click(modifierButtons[1]!);
      const nameInput = screen.getByLabelText("Nom de Avant");
      await user.clear(nameInput);
      await user.type(nameInput, "Après");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      const table = await screen.findByRole("table");
      await waitFor(() => {
        expect(within(table).getByText("Après")).toBeInTheDocument();
      });
      expect(within(table).queryByText("Avant")).not.toBeInTheDocument();
    });

    it("cancels a category name edit without saving", async () => {
      const session = await createTestUser("admin");
      await db.budgetCategories.add(
        await encryptedFixture(
          { id: "cat-1", name: "Original", createdAt: Date.now(), updatedAt: Date.now() },
          ["name"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      await user.click(await screen.findByRole("button", { name: /^modifier$/i }));
      const nameInput = screen.getByLabelText("Nom de Original");
      await user.clear(nameInput);
      await user.type(nameInput, "Ne devrait pas être enregistré");
      await user.click(screen.getByRole("button", { name: /annuler/i }));

      const table = screen.getByRole("table");
      expect(within(table).getByText("Original")).toBeInTheDocument();
      expect(within(table).queryByText("Ne devrait pas être enregistré")).not.toBeInTheDocument();
    });

    it("does not show Modifier buttons for a user without manageBudget", async () => {
      const session = await createTestUser("viewer");
      await db.budgetCategories.add(
        await encryptedFixture(
          { id: "cat-1", name: "Catégorie", createdAt: Date.now(), updatedAt: Date.now() },
          ["name"] as const,
        ),
      );
      renderWithSession(<BudgetPanel />, session);

      const table = await screen.findByRole("table");
      await within(table).findByText("Catégorie");
      expect(screen.queryByRole("button", { name: /modifier/i })).not.toBeInTheDocument();
    });
  });

  describe("engagements", () => {
    async function seedCategoryAndSubcategory() {
      await db.budgetCategories.add(
        await encryptedFixture(
          { id: "cat-1", name: "Vie Courante", createdAt: Date.now(), updatedAt: Date.now() },
          ["name"] as const,
        ),
      );
      await db.budgetSubcategories.add(
        await encryptedFixture(
          {
            id: "sub-1",
            categoryId: "cat-1",
            name: "Scolarité",
            monthlyAllocation: 50000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["name", "monthlyAllocation"] as const,
        ),
      );
    }

    it("does not show the engagement form with no subcategories yet", async () => {
      await renderAuthenticated(<BudgetPanel />);
      await screen.findByText(/aucune catégorie/i);
      expect(screen.queryByText(/engagements sur le budget/i)).not.toBeInTheDocument();
    });

    it("creates an engagement and reduces the visible remaining amount", async () => {
      const session = await createTestUser("admin");
      await seedCategoryAndSubcategory();
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      await user.selectOptions(await screen.findByLabelText(/ligne budgétaire/i), "sub-1");
      await user.type(screen.getByLabelText(/^montant$/i), "30000");
      await user.type(screen.getByLabelText(/^libellé$/i), "Frais de scolarité");
      await user.click(
        within(screen.getByRole("form", { name: /ajouter un engagement/i })).getByRole("button", {
          name: /^\+ ajouter$/i,
        }),
      );

      const row = await screen.findByText("Frais de scolarité").then((el) => el.closest("tr")!);
      expect(row).toHaveTextContent("30 000 FCFA");
      expect(row).toHaveTextContent("Engagé");

      const summaryTable = screen.getAllByRole("table")[0]!;
      await waitFor(() => {
        expect(within(summaryTable).getByText("Scolarité").closest("tr")).toHaveTextContent(
          "20 000 FCFA",
        );
      });
    });

    it("changes an engagement's status", async () => {
      const session = await createTestUser("admin");
      await seedCategoryAndSubcategory();
      await db.engagements.add(
        await encryptedFixture<Engagement, "amount" | "label" | "note">(
          {
            id: "eng-1",
            subcategoryId: "sub-1",
            date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-15`,
            status: "engaged" as const,
            amount: 10000,
            label: "Test",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      const statusSelect = await screen.findByLabelText(/statut de l'engagement test/i);
      await user.selectOptions(statusSelect, "realized");

      await waitFor(async () => {
        const updated = await db.engagements.get("eng-1");
        const decrypted = await fromStorageRow<{ status: string }>(updated!);
        expect(decrypted.status).toBe("realized");
      });
    });

    it("shows Payé: Oui once an engagement is réalisé, Non otherwise", async () => {
      const session = await createTestUser("admin");
      await seedCategoryAndSubcategory();
      await db.engagements.add(
        await encryptedFixture<Engagement, "amount" | "label" | "note">(
          {
            id: "eng-1",
            subcategoryId: "sub-1",
            date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-15`,
            status: "engaged" as const,
            amount: 10000,
            label: "Test",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      const row = (await screen.findByText("Test")).closest("tr")!;
      expect(row).toHaveTextContent("Non");

      const statusSelect = await screen.findByLabelText(/statut de l'engagement test/i);
      await user.selectOptions(statusSelect, "realized");

      await waitFor(() => {
        expect(row).toHaveTextContent("Oui");
      });
    });

    it("edits an engagement's amount and label", async () => {
      const session = await createTestUser("admin");
      await seedCategoryAndSubcategory();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
      await db.engagements.add(
        await encryptedFixture<Engagement, "amount" | "label" | "note">(
          {
            id: "eng-1",
            subcategoryId: "sub-1",
            date: dateStr,
            status: "engaged" as const,
            amount: 10000,
            label: "Avant",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      await screen.findByText("Avant");
      const engagementRow = screen.getByText("Avant").closest("tr")!;
      await user.click(within(engagementRow).getByRole("button", { name: /^modifier$/i }));
      const labelInput = screen.getByLabelText(/libellé de l'engagement avant/i);
      await user.clear(labelInput);
      await user.type(labelInput, "Après");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        expect(screen.getByText("Après")).toBeInTheDocument();
      });
      expect(screen.queryByText("Avant")).not.toBeInTheDocument();
    });

    it("deletes an engagement", async () => {
      const session = await createTestUser("admin");
      await seedCategoryAndSubcategory();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
      await db.engagements.add(
        await encryptedFixture<Engagement, "amount" | "label" | "note">(
          {
            id: "eng-1",
            subcategoryId: "sub-1",
            date: dateStr,
            status: "engaged" as const,
            amount: 10000,
            label: "À supprimer",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"] as const,
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<BudgetPanel />, session);

      await screen.findByText("À supprimer");
      const engagementRow = screen.getByText("À supprimer").closest("tr")!;
      await user.click(within(engagementRow).getByRole("button", { name: /supprimer/i }));

      await waitFor(() => {
        expect(screen.queryByText("À supprimer")).not.toBeInTheDocument();
      });
    });

    it("does not show the engagement form or Modifier buttons for a user without manageBudget", async () => {
      const session = await createTestUser("viewer");
      await seedCategoryAndSubcategory();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
      await db.engagements.add(
        await encryptedFixture<Engagement, "amount" | "label" | "note">(
          {
            id: "eng-1",
            subcategoryId: "sub-1",
            date: dateStr,
            status: "engaged" as const,
            amount: 10000,
            label: "Visible",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"] as const,
        ),
      );
      renderWithSession(<BudgetPanel />, session);

      await screen.findByText("Visible");
      expect(screen.queryByLabelText(/ligne budgétaire$/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /modifier/i })).not.toBeInTheDocument();
    });
  });
});
