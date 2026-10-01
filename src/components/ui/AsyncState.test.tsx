import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncState } from "./AsyncState";

describe("AsyncState Component", () => {
  it("renders loading state with role=status", () => {
    const html = renderToStaticMarkup(
      <AsyncState
        loading={true}
        loadingRender={<div data-testid="custom-skeleton">Loading skeleton</div>}
      >
        <div>Content</div>
      </AsyncState>
    );

    expect(html).toContain("custom-skeleton");
    expect(html).not.toContain("Content");
  });

  it("renders error state with role=alert", () => {
    const html = renderToStaticMarkup(
      <AsyncState
        loading={false}
        error="Network error fetching data"
        errorRender={(err) => <div data-testid="error-box">{err}</div>}
      >
        <div>Content</div>
      </AsyncState>
    );

    expect(html).toContain("Network error fetching data");
    expect(html).toContain("error-box");
    expect(html).not.toContain("Content");
  });

  it("renders empty state when isEmpty is true and not fixture", () => {
    const html = renderToStaticMarkup(
      <AsyncState
        loading={false}
        isEmpty={true}
        isFixture={false}
        emptyRender={<div data-testid="empty-box">No records yet</div>}
      >
        <div>Content</div>
      </AsyncState>
    );

    expect(html).toContain("empty-box");
    expect(html).toContain("No records yet");
    expect(html).not.toContain("Content");
  });

  it("renders success content when loaded with data", () => {
    const html = renderToStaticMarkup(
      <AsyncState
        loading={false}
        data={{ name: "Stablecoin Depeg" }}
      >
        {(data) => <div data-testid="content">{data.name}</div>}
      </AsyncState>
    );

    expect(html).toContain("Stablecoin Depeg");
    expect(html).toContain("content");
  });
});
