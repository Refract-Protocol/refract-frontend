import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalSearch from "../GlobalSearch";
import * as fuzzySearchModule from "../../lib/fuzzySearch";

const items = [
  { id: "1", label: "Alpha" },
  { id: "2", label: "Beta" },
  { id: "3", label: "Gamma" },
];

describe("GlobalSearch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("debounces fuzzySearch to a single call after rapid typing", async () => {
    const spy = jest.spyOn(fuzzySearchModule, "fuzzySearch");
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch items={items} debounceMs={200} />);

    const input = screen.getByLabelText("Global search");
    await user.type(input, "alpha");

    // No search should have run yet while typing.
    expect(spy).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(items, "alpha", expect.any(Function), 5);
  });
});
