import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Ensure the DOM is reset between tests so component tests stay isolated.
afterEach(() => {
  cleanup();
});

// Next.js navigation hooks are not available outside the Next.js runtime.
// Provide lightweight defaults so component tests (e.g. Navbar) can render
// without a full Next.js app context. Individual tests can still override
// these with vi.mock("next/navigation", ...) when they need specific values.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
