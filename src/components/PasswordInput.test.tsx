import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PasswordInput } from "./PasswordInput";

function ControlledPasswordInput() {
  const [value, setValue] = useState("");
  return (
    <div>
      <label htmlFor="pw">Mot de passe</label>
      <PasswordInput id="pw" value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}

describe("PasswordInput", () => {
  it("masks the value by default", () => {
    render(<ControlledPasswordInput />);
    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute("type", "password");
  });

  it("reveals the value as plain text when the toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<ControlledPasswordInput />);

    await user.type(screen.getByLabelText("Mot de passe"), "secret123");
    await user.click(screen.getByRole("button", { name: /afficher le mot de passe/i }));

    const input = screen.getByLabelText("Mot de passe");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("secret123");
  });

  it("re-masks the value when the toggle is clicked again", async () => {
    const user = userEvent.setup();
    render(<ControlledPasswordInput />);

    await user.click(screen.getByRole("button", { name: /afficher le mot de passe/i }));
    await user.click(screen.getByRole("button", { name: /masquer le mot de passe/i }));

    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute("type", "password");
  });

  it("still receives typed input normally (a drop-in replacement, not a different control)", async () => {
    const user = userEvent.setup();
    render(<ControlledPasswordInput />);

    await user.type(screen.getByLabelText("Mot de passe"), "hello");
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("hello");
  });

  it("keeps each field's visibility independent when multiple are rendered", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <label htmlFor="pw1">Premier</label>
        <PasswordInput id="pw1" value="a" onChange={() => {}} />
        <label htmlFor="pw2">Second</label>
        <PasswordInput id="pw2" value="b" onChange={() => {}} />
      </div>,
    );

    await user.click(screen.getAllByRole("button", { name: /afficher le mot de passe/i })[0]!);

    expect(screen.getByLabelText("Premier")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Second")).toHaveAttribute("type", "password");
  });
});
