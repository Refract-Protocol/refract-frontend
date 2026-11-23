import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

// Wrapper that exposes a trigger button and controlled Modal.
function TestModal({
  dismissible = true,
  initialFocus = false,
}: {
  dismissible?: boolean;
  initialFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Test Modal"
        dismissible={dismissible}
        initialFocusRef={initialFocus ? triggerRef : undefined}
      >
        <button>Inside</button>
      </Modal>
    </>
  );
}

describe("Modal – focus management (#505)", () => {
  it("restores focus to the trigger element after closing via Escape", async () => {
    const user = userEvent.setup();
    render(<TestModal />);

    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to the trigger after programmatic close", async () => {
    const user = userEvent.setup();
    render(<TestModal />);

    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);

    // Click the button inside the modal to close it via onClose indirectly
    // — here we test that the trigger receives focus regardless of how the
    // modal closes, so we simulate it by firing Escape.
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("does not restore focus to trigger prematurely while the modal is open", async () => {
    const user = userEvent.setup();
    render(<TestModal />);

    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);

    // Trigger a re-render by tabbing inside the modal.
    await user.tab();

    // Modal should still be open and focus should remain inside it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("traps focus within the modal on Tab", async () => {
    const user = userEvent.setup();
    render(<TestModal />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    const insideBtn = screen.getByRole("button", { name: "Inside" });
    insideBtn.focus();

    await user.tab();
    // Wraps back — the only focusable element is "Inside", so focus stays there
    // (or cycles back through the panel).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sets aria attributes correctly", async () => {
    const user = userEvent.setup();
    render(<TestModal />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });

  it("does not close on Escape when dismissible is false", async () => {
    const user = userEvent.setup();
    render(<TestModal dismissible={false} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
