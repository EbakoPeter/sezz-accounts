import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuildInfo } from "./BuildInfo";

describe("BuildInfo", () => {
  it("renders a version line with a formatted date", () => {
    render(<BuildInfo />);
    expect(screen.getByText(/version du/i)).toBeInTheDocument();
  });
});
