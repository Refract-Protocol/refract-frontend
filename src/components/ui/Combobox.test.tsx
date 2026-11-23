import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Combobox } from "./Combobox";

const OPTIONS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "disabled-opt", label: "Disabled", disabled: true },
];

describe("Combobox – ARIA attributes (#507)", () => {
  it("input has role=combobox", () => {
    render(<Combobox options={OPTIONS} label="Fruit" />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("aria-expanded is false when closed", () => {
    render(<Combobox options={OPTIONS} label="Fruit" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("aria-expanded becomes true when the listbox opens", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" />);

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
  });

  it("aria-controls points to the listbox element", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" />);

    await user.click(screen.getByRole("combobox"));
    const listbox = screen.getByRole("listbox");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-controls", listbox.id);
  });

  it("aria-activedescendant is absent when no option is active", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" />);

    await user.click(screen.getByRole("combobox"));
    // Listbox opened but no keyboard nav yet, so no active descendant.
    const input = screen.getByRole("combobox");
    expect(
      input.getAttribute("aria-activedescendant") === null ||
        input.getAttribute("aria-activedescendant") === ""
    ).toBe(true);
  });

  it("aria-activedescendant identifies the highlighted option after ArrowDown", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" />);

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("{ArrowDown}");

    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();

    const activeOption = document.getElementById(activeId!);
    expect(activeOption).not.toBeNull();
    expect(activeOption).toHaveAttribute("role", "option");
  });

  it("active option has aria-selected when it matches the controlled value", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" value="apple" />);

    await user.click(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option");
    const apple = options.find((o) => o.textContent === "Apple");
    expect(apple).toHaveAttribute("aria-selected", "true");
  });
});

describe("Combobox – keyboard navigation (#507)", () => {
  it("opens the listbox on ArrowDown", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("selects an option with Enter and closes the listbox", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" onChange={onChange} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("apple");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the listbox on Escape without selecting", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" onChange={onChange} />);

    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters options as the user types", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} label="Fruit" filterable />);

    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "an");

    const listOptions = screen.getAllByRole("option");
    // "Banana" matches "an"; "Apple" and "Cherry" do not.
    expect(listOptions).toHaveLength(1);
    expect(listOptions[0]).toHaveTextContent("Banana");
  });
});
