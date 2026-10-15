"use client";

import { useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { invalidateFeatureSnapshot } from "@/hooks/use-features";
import { api } from "@/lib/api-client";
import { analyticsProjectIdAtom } from "@/lib/atoms/analytics";
import { authClient } from "@/lib/auth-client";
import { useOrganizationsData } from "@/lib/hooks/use-org-data";
import { registerOrganizationRefetch } from "@/lib/refetch-organizations";
import { refetchSidebar } from "@/lib/refetch-sidebar";
import { latestVisibleWorkflow } from "@/lib/workflow/latest-workflow";
import { resetWorkflowStateForOrgSwitchAtom } from "@/lib/workflow/store";

// A fresh page load a switch asked for, as the server had switched (`to`)
// but the page still showed the org it was in (`from`). Kept in the tab
// until the page shows `to`, or an org other than `from` (another tab has
// moved the session on): a page that still shows `from` reports the switch
// as failed rather than loading again, so nothing loads again and again.
const RELOADED_FOR_KEY = "kh-org-switch-reloaded-for";

type FreshLoad = { to: string; from: string | null };

function freshLoad(): FreshLoad | null {
  try {
    const stored = window.sessionStorage.getItem(RELOADED_FOR_KEY);
    return stored ? (JSON.parse(stored) as FreshLoad) : null;
  } catch {
    return null;
  }
}

function noteFreshLoad(load: FreshLoad | null): void {
  try {
    if (load === null) {
      window.sessionStorage.removeItem(RELOADED_FOR_KEY);
    } else {
      window.sessionStorage.setItem(RELOADED_FOR_KEY, JSON.stringify(load));
    }
  } catch {
    // No storage (a sandboxed frame): a page that cannot show the org may
    // then load afresh again, as each switch is asked for.
  }
}

/** The active org's id as the auth client holds it now, not as last rendered. */
export function currentActiveOrgId(): string | undefined {
  return authClient.$store.atoms.activeOrganization.get().data?.id;
}

// The auth server's answers that the active org is gone: not found (400:
// deleted; 404 taken the same way) or not a member (403: removed from it).
// Every other failure (no answer, a timeout, too many requests, the
// server's own error) may pass, and there may still be an org.
const GONE_STATUSES: ReadonlySet<number> = new Set([400, 403, 404]);

// Whether the active org's request failed in a way a retry can mend: not
// knowing it is not having none. An org that is gone is as none active.
function couldNotLoad(error: { status?: number } | null | undefined): boolean {
  if (!error) {
    return false;
  }
  return !GONE_STATUSES.has(error.status ?? 0);
}

/** Whether the active org's last request failed in a way a retry can mend. */
export function activeOrgLoadFailed(): boolean {
  return couldNotLoad(authClient.$store.atoms.activeOrganization.get().error);
}

export function useOrganization() {
  const {
    data: activeOrg,
    isPending,
    error,
    refetch,
  } = authClient.useActiveOrganization();
  const router = useRouter();
  const setAnalyticsProjectId = useSetAtom(analyticsProjectIdAtom);
  // Through the hook, not getDefaultStore: the app mounts its own jotai store
  // in app/layout.tsx, and a write to the default one lands where nothing is
  // reading, which is why this reset never ran.
  const resetWorkflowStateForOrgSwitch = useSetAtom(
    resetWorkflowStateForOrgSwitchAtom
  );

  // The page shows an org: a fresh load asked for earlier is over, whether
  // it showed that org or another tab has moved the session on since.
  useEffect(() => {
    const load = freshLoad();
    if (
      activeOrg?.id &&
      load !== null &&
      (activeOrg.id === load.to || activeOrg.id !== load.from)
    ) {
      noteFreshLoad(null);
    }
  }, [activeOrg?.id]);

  // Register this hook's refetch callback so it can be triggered externally
  useEffect(
    () =>
      registerOrganizationRefetch(() => {
        console.log("[useOrganization] Refetching active organization...");
        refetch();
      }),
    [refetch]
  );

  // Resolves to whether the switch took: the auth client reports a failure
  // instead of throwing. A failed switch changes nothing here.
  // `fromPath`: the page to switch from, for a caller already leaving the
  // one shown.
  const switchOrganization = useCallback(
    async (orgId: string, fromPath?: string): Promise<boolean> => {
      const { error: switchError } = await authClient.organization.setActive({
        organizationId: orgId,
      });
      if (switchError) {
        return false;
      }
      // Resolves once the new org is the one shown (or the page is loading
      // afresh to show it), so callers (and the switchers waiting on them)
      // never act on a page with no org active.
      await refetch();
      // The server has switched, so every request now runs as the new org.
      // Should the reload have failed and kept the old one, the page is loaded
      // afresh rather than left showing it; once only, so a page that still
      // shows the old org never loads again and again: then the switch
      // failed.
      const shown = currentActiveOrgId() ?? null;
      const stale = shown !== orgId;
      if (stale) {
        const load = freshLoad();
        if (load?.to === orgId && load.from === shown) {
          return false;
        }
        noteFreshLoad({ to: orgId, from: shown });
      }
      const open = (href: string, replace: boolean): void => {
        if (stale) {
          window.location[replace ? "replace" : "assign"](href);
        } else if (replace) {
          router.replace(href);
        } else {
          router.push(href);
        }
      };
      // Otherwise the page as it is now: a retry can come after the page has
      // changed.
      const pathname = fromPath ?? window.location.pathname;
      const reload = (): void => {
        if (!stale) {
          router.refresh();
        } else if (fromPath) {
          // The caller is already leaving the page shown, for this one.
          window.location.replace(fromPath);
        } else {
          window.location.reload();
        }
      };
      // Reset workflow state only after the switch took (safe in hook context).
      resetWorkflowStateForOrgSwitch();
      setAnalyticsProjectId(null);
      invalidateFeatureSnapshot();
      refetchSidebar({ orgChanged: true });

      // Org-scoped settings carry the organization in the path, so switching has
      // to rewrite it. Otherwise the route would keep pointing at the previous
      // org and immediately switch back to it.
      if (pathname.startsWith("/settings/")) {
        const parts = pathname.split("/");
        if (parts.length > 3) {
          parts[2] = orgId;
          open(parts.join("/"), false);
        } else {
          reload();
        }
        return true;
      }

      // Stay on non-workflow pages (e.g. /analytics, /hub, /billing) after switching orgs
      const isWorkflowPage = pathname.startsWith("/workflows/");
      if (!isWorkflowPage) {
        reload();
        return true;
      }

      try {
        // The new org's last-edited workflow the lists show (not the
        // internal __current__ one, nor a deleted one).
        const mostRecent = latestVisibleWorkflow(await api.workflow.getAll());
        open(mostRecent ? `/workflows/${mostRecent.id}` : "/", true);
      } catch (fetchError) {
        console.error(
          "Failed to fetch workflows after org switch:",
          fetchError
        );
        open("/", true);
      }
      return true;
    },
    [refetch, router, resetWorkflowStateForOrgSwitch, setAnalyticsProjectId]
  );

  return {
    organization: activeOrg,
    isLoading: isPending,
    error,
    // The active org could not be loaded, though there may be one.
    loadFailed: couldNotLoad(error),
    switchOrganization,
    refetch, // Keep exposing refetch for direct use
  };
}

export type { OrganizationWithRole } from "@/lib/atoms/organization";

/**
 * The organizations the user belongs to. One shared request no matter how many
 * components ask; see `lib/atoms/organization.ts`.
 */
export function useOrganizations() {
  const {
    data: organizations,
    isLoading,
    hasError,
    refetch,
    reload,
  } = useOrganizationsData();
  return { organizations, isLoading, hasError, refetch, reload };
}

export function useActiveMember() {
  // Use useActiveOrganization to get member info from the organization context
  const { data: activeOrg, isPending } = authClient.useActiveOrganization();

  // Get the session to find current user's membership
  const { data: session } = authClient.useSession();

  // Find the current user's member record in the active organization
  const member = activeOrg?.members?.find(
    (m: { userId: string }) => m.userId === session?.user?.id
  );

  return {
    member: member || null,
    isLoading: isPending,
    role: member?.role as "owner" | "admin" | "member" | undefined,
    isOwner: member?.role === "owner",
    isAdmin: member?.role === "admin" || member?.role === "owner",
  };
}

export function usePermissions() {
  const checkPermission = async (resource: string, actions: string[]) => {
    try {
      const result = await authClient.organization.hasPermission({
        permissions: { [resource]: actions },
      });
      // Handle both data.success and direct success property
      const typedResult = result as {
        data?: { success?: boolean };
        success?: boolean;
      } | null;
      return typedResult?.data?.success || typedResult?.success;
    } catch (error) {
      console.error("Permission check failed:", error);
      return false;
    }
  };

  const checkLocalPermission = (
    role: "owner" | "admin" | "member",
    resource: string,
    actions: string[]
  ) =>
    authClient.organization.checkRolePermission({
      role,
      permissions: { [resource]: actions },
    });

  return {
    checkPermission,
    checkLocalPermission,
  };
}
