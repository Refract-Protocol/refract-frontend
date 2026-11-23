import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tab, TabList, TabPanel, TabPanels, Tabs } from "./Tabs";

function SimpleTabs({ activationMode = "automatic" as const }) {
  return (
    <Tabs defaultValue="a" activationMode={activationMode}>
      <TabList>
        <Tab value="a">Tab A</Tab>
        <Tab value="b">Tab B</Tab>
        <Tab value="c">Tab C</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="a">Panel A</TabPanel>
        <TabPanel value="b">Panel B</TabPanel>
        <TabPanel value="c">Panel C</TabPanel>
      </TabPanels>
    </Tabs>
  );
}

describe("Tabs – roles and ARIA (#506)", () => {
  it("renders correct ARIA roles", () => {
    render(<SimpleTabs />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    // Only the selected panel is visible (not hidden).
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("marks the selected tab with aria-selected=true", () => {
    render(<SimpleTabs />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");
  });

  it("links each tab to its panel via aria-controls / aria-labelledby", () => {
    render(<SimpleTabs />);
    const [tabA] = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    expect(tabA).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tabA.id);
  });
});

describe("Tabs – arrow-key navigation (#506)", () => {
  it("moves focus right with ArrowRight in automatic mode and selects the tab", async () => {
    const user = userEvent.setup();
    render(<SimpleTabs activationMode="automatic" />);

    const [tabA, tabB] = screen.getAllByRole("tab");
    tabA.focus();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(tabB);
    expect(tabB).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel B");
  });

  it("moves focus left with ArrowLeft", async () => {
    const user = userEvent.setup();
    render(<SimpleTabs />);

    const [tabA, tabB, tabC] = screen.getAllByRole("tab");
    tabC.focus();
    await user.keyboard("{ArrowLeft}");

    expect(document.activeElement).toBe(tabB);
  });

  it("wraps from last tab to first on ArrowRight", async () => {
    const user = userEvent.setup();
    render(<SimpleTabs />);

    const [tabA, , tabC] = screen.getAllByRole("tab");
    tabC.focus();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(tabA);
  });

  it("moves focus to first tab on Home", async () => {
    const user = userEvent.setup();
    render(<SimpleTabs />);

    const [tabA, , tabC] = screen.getAllByRole("tab");
    tabC.focus();
    await user.keyboard("{Home}");

    expect(document.activeElement).toBe(tabA);
  });

  it("moves focus to last tab on End", async () => {
    const user = userEvent.setup();
    render(<SimpleTabs />);

    const [tabA, , tabC] = screen.getAllByRole("tab");
    tabA.focus();
    await user.keyboard("{End}");

    expect(document.activeElement).toBe(tabC);
  });

  it("focuses but does not select in manual mode until Enter", async () => {
    const user = userEvent.setup();
    render(<SimpleTabs activationMode="manual" />);

    const [tabA, tabB] = screen.getAllByRole("tab");
    tabA.focus();
    await user.keyboard("{ArrowRight}");

    // Focus moved but tab A is still selected.
    expect(document.activeElement).toBe(tabB);
    expect(tabA).toHaveAttribute("aria-selected", "true");
    expect(tabB).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Enter}");
    expect(tabB).toHaveAttribute("aria-selected", "true");
  });
});
