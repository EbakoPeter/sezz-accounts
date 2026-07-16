import { afterEach, describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { MonthlyReportPanel } from "./MonthlyReportPanel";
import { db } from "@/db/schema";
import { renderAuthenticated } from "@/test/renderAuthenticated";

afterEach(async () => {
  await db.users.clear();
  await db.transactions.clear();
  await db.accounts.clear();
});

describe("MonthlyReportPanel", () => {
  it("renders 12 month rows even with no data", async () => {
    await renderAuthenticated(<MonthlyReportPanel />);
    const rows = await screen.findAllByRole("row");
    // header + 12 month rows + footer total row
    expect(rows).toHaveLength(14);
    expect(screen.getByText("Janvier")).toBeInTheDocument();
    expect(screen.getByText("Décembre")).toBeInTheDocument();
  });

  it("renders the chart", async () => {
    await renderAuthenticated(<MonthlyReportPanel />);
    expect(await screen.findByRole("img", { name: /graphique/i })).toBeInTheDocument();
  });

  it("shows transaction totals in the correct month row, for the selected year", async () => {
    await db.accounts.add({
      id: "acc-1",
      name: "Compte",
      initialBalance: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.transactions.add({
      id: "tx-1",
      accountId: "acc-1",
      kind: "income",
      date: "2026-05-01",
      label: "Salaire",
      amount: 250000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    await renderAuthenticated(<MonthlyReportPanel />);
    fireEvent.change(await screen.findByLabelText(/année/i), { target: { value: "2026" } });

    const table = await screen.findByRole("table");
    const mayRow = within(table).getByText("Mai").closest("tr");
    expect(mayRow!).toHaveTextContent("250 000 FCFA");
  });

  it("switching the year updates the report", async () => {
    await db.accounts.add({
      id: "acc-1",
      name: "Compte",
      initialBalance: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.transactions.add({
      id: "tx-2025",
      accountId: "acc-1",
      kind: "income",
      date: "2025-06-01",
      label: "Ancien revenu",
      amount: 111111,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    await renderAuthenticated(<MonthlyReportPanel />);
    const yearInput = await screen.findByLabelText(/année/i);
    fireEvent.change(yearInput, { target: { value: "2025" } });

    const table = await screen.findByRole("table");
    await screen.findAllByText("111 111 FCFA"); // wait for the async update to land
    const juneRow = within(table).getByText("Juin").closest("tr");
    expect(juneRow!).toHaveTextContent("111 111 FCFA");
  });
});
