// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setActive: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refetchSidebar: vi.fn(),
  getAll: vi.fn(),
  resetEditor: vi.fn(),
  invalidateFeatures: vi.fn(),
  refetchActive: vi.fn(),
  // The org the page shows after its reload.
  shown: "org-2" as string | null,
  // The active org's request's error, as the auth client gives it.
  activeError: null as { status?: number } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({
      data: { id: "org-1" },
      isPending: false,
      error: mocks.activeError,
      refetch: mocks.refetchActive,
    }),
    organization: { setActive: mocks.setActive },
    $store: {
      atoms: {
        activeOrganization: {
          get: () => ({
            data: mocks.shown ? { id: mocks.shown } : null,
            error: mocks.activeError,
          }),
        },
      },
    },
  },
}));
vi.mock("@/hooks/use-features", () => ({
  invalidateFeatureSnapshot: mocks.invalidateFeatures,
}));
vi.mock("@/lib/api-client", () => ({
  api: { workflow: { getAll: mocks.getAll } },
}));
vi.mock("@/lib/hooks/use-org-data", () => ({
  useOrganizationsData: () => ({
    data: [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/refetch-organizations", () => ({
  registerOrganizationRefetch: () => () => undefined,
}));
vi.mock("@/lib/refetch-sidebar", () => ({
  refetchSidebar: mocks.refetchSidebar,
}));
vi.mock("@/lib/workflow/store", async () => {
  const { atom } = await import("jotai");
  return {
    resetWorkflowStateForOrgSwitchAtom: atom(null, () => mocks.resetEditor()),
  };
});

import {
  activeOrgLoadFailed,
  useOrganization,
} from "@/lib/hooks/use-organization";

let container: HTMLDivElement;
let root: Root;
let switchOrganization: (orgId: string, fromPath?: string) => Promise<boolean> =
  () => Promise.resolve(false);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let loadFailed = false;

function Probe(): null {
  const organization = useOrganization();
  switchOrganization = organization.switchOrganization;
  loadFailed = organization.loadFailed;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/hub");
  mocks.shown = "org-2";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("switchOrganization", () => {
  it("resolves true when the switch takes", async () => {
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    expect(await switchOrganization("org-2")).toBe(true);
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "org-2" });
    expect(mocks.resetEditor).toHaveBeenCalledOnce();
    expect(mocks.invalidateFeatures).toHaveBeenCalledOnce();
    expect(mocks.refetchSidebar).toHaveBeenCalledWith({ orgChanged: true });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("resolves false, and changes nothing, when the switch fails", async () => {
    mocks.setActive.mockResolvedValue({
      data: null,
      error: { message: "Forbidden", status: 403 },
    });
    expect(await switchOrganization("org-2")).toBe(false);
    expect(mocks.resetEditor).not.toHaveBeenCalled();
    expect(mocks.invalidateFeatures).not.toHaveBeenCalled();
    expect(mocks.refetchSidebar).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("opens the new org's last-edited visible workflow from a workflow", async () => {
    window.history.pushState({}, "", "/workflows/old");
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    mocks.getAll.mockResolvedValue([
      { id: "older", name: "A", updatedAt: "2026-10-01T00:00:00Z" },
      { id: "edited", name: "B", updatedAt: "2026-10-02T00:00:00Z" },
      { id: "scratch", name: "__current__", updatedAt: "2026-10-03T00:00:00Z" },
      {
        id: "deleted",
        name: "C",
        updatedAt: "2026-10-04T00:00:00Z",
        deletedAt: "2026-10-05T00:00:00Z",
      },
    ]);
    expect(await switchOrganization("org-2")).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith("/workflows/edited");
  });

  it("goes home when the new org has no workflow to open", async () => {
    window.history.pushState({}, "", "/workflows/old");
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    mocks.getAll.mockResolvedValue([
      { id: "scratch", name: "__current__", updatedAt: "2026-10-03T00:00:00Z" },
    ]);
    await switchOrganization("org-2");
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("goes home when the new org's workflows cannot be listed", async () => {
    window.history.pushState({}, "", "/workflows/old");
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    mocks.getAll.mockRejectedValue(new Error("offline"));
    expect(await switchOrganization("org-2")).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("acts on the page shown when it runs, not when it was set up", async () => {
    // Set up on a workflow, run after moving to another page (a retry).
    window.history.pushState({}, "", "/workflows/old");
    act(() => root.render(<Probe />));
    window.history.pushState({}, "", "/analytics");
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    await switchOrganization("org-2");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("switches from the page a caller names, when it is leaving the one shown", async () => {
    window.history.pushState({}, "", "/settings/org-1/organization");
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    await switchOrganization("org-2", "/settings");
    // /settings has no org in its path: a plain refresh, not a rewrite of the
    // page shown.
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("treats a named workflow page as a workflow page", async () => {
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    mocks.getAll.mockResolvedValue([
      { id: "edited", name: "B", updatedAt: "2026-10-02T00:00:00Z" },
    ]);
    await switchOrganization("org-2", "/workflows/x");
    expect(mocks.replace).toHaveBeenCalledWith("/workflows/edited");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("resolves only once the new org is the one shown", async () => {
    let loaded: () => void = () => undefined;
    mocks.refetchActive.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        loaded = resolve;
      })
    );
    mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
    let settled = false;
    const switching = switchOrganization("org-2").then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    loaded();
    await switching;
    expect(settled).toBe(true);
  });

  it("counts only an error a retry can mend as failing to load", () => {
    const failedFor = (error: { status?: number } | null): boolean => {
      mocks.activeError = error;
      act(() => root.render(<Probe key={JSON.stringify(error)} />));
      return loadFailed;
    };
    try {
      // No answer, or the server's own error: there may be an org.
      expect(failedFor({})).toBe(true);
      expect(failedFor({ status: 500 })).toBe(true);
      expect(failedFor({ status: 503 })).toBe(true);
      // Too many requests, a timeout: they pass.
      expect(failedFor({ status: 429 })).toBe(true);
      expect(failedFor({ status: 408 })).toBe(true);
      // The org is gone, or the user was removed: none to load.
      expect(failedFor({ status: 400 })).toBe(false);
      expect(failedFor({ status: 403 })).toBe(false);
      expect(failedFor({ status: 404 })).toBe(false);
      expect(failedFor(null)).toBe(false);
      // As the auth client holds it now, for a load that has just answered.
      mocks.activeError = { status: 503 };
      expect(activeOrgLoadFailed()).toBe(true);
      mocks.activeError = { status: 400 };
      expect(activeOrgLoadFailed()).toBe(false);
    } finally {
      mocks.activeError = null;
    }
  });

  it("keeps a fresh load while the page still shows the org it was from", () => {
    const load = JSON.stringify({ to: "org-9", from: "org-1" });
    window.sessionStorage.setItem("kh-org-switch-reloaded-for", load);
    // The page shows org-1 (the hook's active org): the load did not take.
    act(() => root.render(<Probe key="again" />));
    expect(window.sessionStorage.getItem("kh-org-switch-reloaded-for")).toBe(
      load
    );
  });

  it("forgets a fresh load once the page shows another org", () => {
    // Loaded afresh for org-9 from org-5; another tab moved the session on.
    window.sessionStorage.setItem(
      "kh-org-switch-reloaded-for",
      JSON.stringify({ to: "org-9", from: "org-5" })
    );
    // The page shows org-1 (the hook's active org).
    act(() => root.render(<Probe key="again" />));
    expect(window.sessionStorage.getItem("kh-org-switch-reloaded-for")).toBe(
      null
    );
  });

  describe("when the reload keeps the old org", () => {
    const location = window.location;
    const reload = vi.fn();
    const assign = vi.fn();
    const replace = vi.fn();

    beforeEach(() => {
      // The server took the switch; the reload failed and kept what it had.
      mocks.shown = "org-1";
      mocks.setActive.mockResolvedValue({ data: { id: "org-2" }, error: null });
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          pathname: location.pathname,
          reload,
          assign,
          replace,
        },
      });
      window.sessionStorage.clear();
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
      });
    });

    it("counts the switch as made and loads the page afresh", async () => {
      expect(await switchOrganization("org-2")).toBe(true);
      // The session is the new org's: the page must not stay the old one's.
      expect(mocks.resetEditor).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("loads an org's settings page afresh", async () => {
      expect(await switchOrganization("org-2", "/settings/org-1/billing")).toBe(
        true
      );
      expect(assign).toHaveBeenCalledWith("/settings/org-2/billing");
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it("opens the new org's last-edited workflow afresh from a workflow", async () => {
      mocks.getAll.mockResolvedValue([
        { id: "edited", name: "B", updatedAt: "2026-10-02T00:00:00Z" },
      ]);
      expect(await switchOrganization("org-2", "/workflows/x")).toBe(true);
      expect(replace).toHaveBeenCalledWith("/workflows/edited");
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("loads the page the caller is going to, not the one shown", async () => {
      // Leaving from an org's settings page, on its way to /settings.
      expect(await switchOrganization("org-2", "/settings")).toBe(true);
      expect(replace).toHaveBeenCalledWith("/settings");
      expect(reload).not.toHaveBeenCalled();
    });

    it("loads afresh again for a fresh load from another org", async () => {
      // An earlier fresh load for org-2 came from org-9, not the org shown.
      window.sessionStorage.setItem(
        "kh-org-switch-reloaded-for",
        JSON.stringify({ to: "org-2", from: "org-9" })
      );
      expect(await switchOrganization("org-2")).toBe(true);
      expect(reload).toHaveBeenCalledOnce();
    });

    it("loads afresh once only: a page that still cannot show the org failed", async () => {
      expect(await switchOrganization("org-2")).toBe(true);
      expect(reload).toHaveBeenCalledOnce();
      // The fresh page (a new mount) still shows the old org: its request
      // keeps failing.
      act(() => root.render(<Probe key="fresh" />));
      expect(await switchOrganization("org-2")).toBe(false);
      expect(reload).toHaveBeenCalledOnce();
      expect(mocks.resetEditor).toHaveBeenCalledOnce();
    });
  });
});
