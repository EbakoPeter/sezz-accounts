import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./BudgetPanel";
import { db } from "@/db/schema";

afterEach(async () => {
  await db.transactions.clear();
  await db.budgetSubcategories.clear();
  await db.budgetCategories.clear();
  await db.accounts.clear();
});

describe("BudgetPanel", () => {
  it("shows an empty state with no categories", async () => {
    render(<BudgetPanel />);
    expect(await screen.findByText(/aucune catégorie/i)).toBeInTheDocument();
  });

  it("creates a category through the form", async () => {
    const user = userEvent.setup();
    render(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Vie Courante");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);

    expect(await screen.findByText("Vie Courante")).toBeInTheDocument();
  });

  it("rejects a duplicate category name inline", async () => {
    const user = userEvent.setup();
    render(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Logement");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);
    await waitFor(() => expect(screen.getByLabelText(/nouvelle catégorie/i)).toHaveValue(""));

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Logement");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(/existe déjà/i);
  });

  it("creates a subcategory once a category exists, and shows it under that category", async () => {
    const user = userEvent.setup();
    render(<BudgetPanel />);

    await user.type(screen.getByLabelText(/nouvelle catégorie/i), "Vie Courante");
    await user.click(screen.getAllByRole("button", { name: /ajouter/i })[0]!);
    await screen.findByText("Vie Courante");

    await user.selectOptions(screen.getByLabelText(/^catégorie$/i), "Vie Courante");
    await user.type(screen.getByLabelText(/^sous-catégorie$/i), "Transport");
    const allocationInput = screen.getByLabelText(/budget mensuel$/i);
    await user.clear(allocationInput);
    await user.type(allocationInput, "25000");
    await user.click(screen.getAllByRole("button", { name: /\+ ajouter/i })[1]!);

    expect(await screen.findByText("Transport")).toBeInTheDocument();
  });

  it("updates an allocation inline and reflects it live", async () => {
    const categoryId = await db.budgetCategories.add({
      id: "cat-1",
      name: "Vie Courante",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.budgetSubcategories.add({
      id: "sub-1",
      categoryId: "cat-1",
      name: "Transport",
      monthlyAllocation: 10000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    void categoryId;

    const user = userEvent.setup();
    render(<BudgetPanel />);

    const input = await screen.findByLabelText("Budget mensuel de Transport");
    expect(input).toHaveValue(10000);
    await user.clear(input);
    await user.type(input, "30000");
    await user.tab(); // triggers onBlur

    await waitFor(async () => {
      const updated = await db.budgetSubcategories.get("sub-1");
      expect(updated?.monthlyAllocation).toBe(30000);
    });
  });

  it("blocks deleting a subcategory still referenced by a transaction", async () => {
    await db.accounts.add({
      id: "acc-1",
      name: "Compte",
      initialBalance: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.budgetCategories.add({
      id: "cat-1",
      name: "Vie Courante",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.budgetSubcategories.add({
      id: "sub-1",
      categoryId: "cat-1",
      name: "Transport",
      monthlyAllocation: 10000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.transactions.add({
      id: "tx-1",
      accountId: "acc-1",
      kind: "expense",
      date: "2020-01-01",
      label: "Vieux",
      amount: 100,
      subcategoryId: "sub-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    const user = userEvent.setup();
    render(<BudgetPanel />);

    await screen.findByText("Transport");
    const deleteButtons = await screen.findAllByRole("button", { name: /supprimer/i });
    // first Supprimer is the category row's, second is the subcategory's
    await user.click(deleteButtons[1]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(/opération/i);
    expect(screen.getByText("Transport")).toBeInTheDocument();
  });
});
