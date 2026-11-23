import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";

function TestDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open Dialog</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Confirm action"
        description="This cannot be undone."
        footer={<button onClick={() => setOpen(false)}>Confirm</button>}
      >
        <p>Dialog body</p>
      </Dialog>
    </>
  );
}

describe("Dialog – focus management (#505)", () => {
  it("restores focus to the trigger after closing via Escape", async () => {
    const user = userEvent.setup();
    render(<TestDialog />);

    const trigger = screen.getByRole("button", { name: "Open Dialog" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to the trigger after clicking the Confirm button", async () => {
    const user = userEvent.setup();
    render(<TestDialog />);

    const trigger = screen.getByRole("button", { name: "Open Dialog" });
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("sets ARIA attributes correctly", async () => {
    const user = userEvent.setup();
    render(<TestDialog />);

    await user.click(screen.getByRole("button", { name: "Open Dialog" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAttribute("aria-describedby");
  });

  it("does not close on backdrop click when target is not the backdrop itself", async () => {
    const user = userEvent.setup();
    render(<TestDialog />);

    await user.click(screen.getByRole("button", { name: "Open Dialog" }));
    // Clicking inside the panel should not close the dialog.
    await user.click(screen.getByText("Dialog body"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
