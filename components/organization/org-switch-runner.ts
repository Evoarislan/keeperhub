import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { currentActiveOrgId } from "@/lib/hooks/use-organization";

export type OfferedOrg = { id: string; name: string };

// Who is switching the active organization: the org switchers and the links
// that open an org (one switch at a time; another pick or Try again is
// ignored), or other code holding the switchers still while it switches
// (leaving, deleting or creating one). A leave, delete or create can start
// while a switch runs; the switchers then wait for both.
let holders = 0;
// No organization is active and opening this one failed (the first switch,
// or the switch after leaving or deleting one): both switchers offer it
// again rather than opening one themselves. Null once one is active.
let offeredOrg: OfferedOrg | null = null;
// The org a running switch asked for from a control that goes away (a
// toast's Try again, the switcher's state button) is opening: focus goes to
// the switcher once it shows that org. Set before the switch starts, as the
// org can show before the switch is done (on a workflow page it then finds
// the workflow to open); cleared when the switch fails.
let focusAfterOrgId: string | null = null;
// For a load of the active org asked for from the switcher: whichever org
// shows takes the focus request.
const ANY_ORG = "*";
// The active org is being loaded again after it could not be.
let reloadingOrg = false;
// A load the user asked for found no org active (it is gone): the org the
// switchers then open is announced, as nothing else answers the load.
let announceNextOpen = false;
// The header's switcher offers to try again (to open an org, or load the
// active one): where it is otherwise hidden, it shows.
let switcherOffering = false;
const listeners = new Set<() => void>();
// The toast the last switch left; the next switch clears it.
let lastSwitchToast: string | number | undefined;
// The active org as the switchers last saw it, so no switch (a Try again
// among them) switches to an org that is already active (one the server
// took though its answer was lost, or one opened another way meanwhile).
let activeOrgId: string | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSwitching(): boolean {
  return holders > 0;
}

function getOfferedOrg(): OfferedOrg | null {
  return offeredOrg;
}

function getReloadingOrg(): boolean {
  return reloadingOrg;
}

function getSwitcherOffering(): boolean {
  return switcherOffering;
}

/** The header's switcher's note of whether it offers to try again. */
export function noteSwitcherOffering(offering: boolean): void {
  if (switcherOffering !== offering) {
    switcherOffering = offering;
    notify();
  }
}

/**
 * Whether the header's switcher offers to try again. Read without the org
 * hooks, which fetch, so a header shown signed out can read it.
 */
export function useSwitcherOffering(): boolean {
  return useSyncExternalStore(
    subscribe,
    getSwitcherOffering,
    getSwitcherOffering
  );
}

function hold(): void {
  holders += 1;
  notify();
}

function release(): void {
  holders -= 1;
  notify();
}

/** Whether the active organization is being switched. */
export function useOrgSwitching(): boolean {
  return useSyncExternalStore(subscribe, getSwitching, getSwitching);
}

/** Whether the active org is being loaded again after it could not be. */
export function useOrgReloading(): boolean {
  return useSyncExternalStore(subscribe, getReloadingOrg, getReloadingOrg);
}

/** The org to offer when none is active because opening one failed. */
export function useOfferedOrg(): OfferedOrg | null {
  return useSyncExternalStore(subscribe, getOfferedOrg, getOfferedOrg);
}

function setOfferedOrg(org: OfferedOrg | null): void {
  offeredOrg = org;
  notify();
}

/** The switchers' note of the active org; one being active ends an offer. */
export function noteActiveOrg(orgId: string | null): void {
  activeOrgId = orgId;
  if (orgId !== null) {
    announceNextOpen = false;
  }
  if (orgId !== null && offeredOrg !== null) {
    setOfferedOrg(null);
  }
}

/**
 * Whether the org the switchers open on their own (none being active) is
 * to be announced: once, after a load the user asked for found none.
 */
export function takeOpenAnnouncement(): boolean {
  const announce = announceNextOpen;
  announceNextOpen = false;
  return announce;
}

// Said when a load the user asked for finds no org active and none to open.
const NO_ORG_MESSAGE = "You're no longer in any organization.";

/**
 * For a switcher that settles with none active and opens none itself (no
 * orgs, or one offered again): an announcement a load left is spent, never
 * kept for a later open the user did not ask for. With no orgs, that is
 * said, as nothing else answers the load.
 */
export function settleOpenAnnouncement(noOrgs: boolean): void {
  if (!announceNextOpen) {
    return;
  }
  announceNextOpen = false;
  if (noOrgs) {
    if (lastSwitchToast !== undefined) {
      toast.dismiss(lastSwitchToast);
    }
    lastSwitchToast = toast.info(NO_ORG_MESSAGE, { duration: 12_000 });
  }
}

/**
 * Whether focus should go to the switcher now that it shows `orgId`. Any
 * other org showing ends the request, so it never moves focus later.
 */
export function takeSwitcherFocus(orgId: string): boolean {
  const asked = focusAfterOrgId === orgId || focusAfterOrgId === ANY_ORG;
  focusAfterOrgId = null;
  return asked;
}

/**
 * Holds the switchers still while other code switches organization, so
 * no switcher switches meanwhile.
 */
export async function holdOrgSwitching<T>(work: () => Promise<T>): Promise<T> {
  hold();
  try {
    return await work();
  } finally {
    release();
  }
}

// What the toasts say, for switching to another org or opening one when none
// is active.
const WORDING = {
  switch: {
    loading: (name: string) => `Switching to ${name}...`,
    success: (name: string) => `Switched to ${name}`,
    failure: (name: string) => `Couldn't switch to ${name}.`,
  },
  open: {
    loading: (name: string) => `Opening ${name}...`,
    success: (name: string) => `Opened ${name}`,
    failure: (name: string) => `Couldn't open ${name}.`,
  },
};

type SwitchRequest = {
  orgId: string;
  name: string;
  start: () => Promise<boolean>;
  // Toasts for progress and success too, where nothing names the org.
  announce: boolean;
  kind?: keyof typeof WORDING;
  // Started from a control that goes away: focus the switcher after.
  refocus?: boolean;
  // Runs once this switch is made, by its first try or its Try again (a
  // link opens what it was for then).
  onSwitched?: () => void;
};

// Says a switch failed, replacing the last switch's toast, with Try again:
// a retry the user starts is announced, and puts focus back on the switcher.
function showFailure(
  message: string,
  request: SwitchRequest,
  id?: string | number
): void {
  if (id === undefined && lastSwitchToast !== undefined) {
    toast.dismiss(lastSwitchToast);
  }
  // Long enough to reach its Try again with a screen reader.
  lastSwitchToast = toast.error(message, {
    id,
    duration: 12_000,
    action: {
      label: "Try again",
      onClick: () => {
        // A retry the user asked for says how it went at every width:
        // nothing else answers the click.
        runOrgSwitch({ ...request, announce: true, refocus: true });
      },
    },
  });
}

/**
 * Runs a switch, unless one is running or the org is already active, and
 * says how it went: a failure always, with Try again, and where nothing on
 * screen names the org (`announce`) its progress and success too. Resolves
 * to whether it switched, or null when it did not run.
 */
export function runOrgSwitch(request: SwitchRequest): Promise<boolean | null> {
  const { orgId, name, start, announce, kind = "switch", refocus } = request;
  if (holders > 0 || orgId === activeOrgId) {
    return Promise.resolve(null);
  }
  hold();
  if (lastSwitchToast !== undefined) {
    toast.dismiss(lastSwitchToast);
    lastSwitchToast = undefined;
  }
  const say = WORDING[kind];
  const id = announce ? toast.loading(say.loading(name)) : undefined;
  if (refocus) {
    focusAfterOrgId = orgId;
  }
  // Through a promise, so a start that throws still lets the lock go.
  return Promise.resolve()
    .then(start)
    .catch((error: unknown) => {
      console.error("[OrgSwitcher] Switch failed", error);
      return false;
    })
    .then((switched) => {
      if (switched) {
        if (offeredOrg !== null) {
          setOfferedOrg(null);
        }
        release();
        if (id !== undefined) {
          lastSwitchToast = toast.success(say.success(name), { id });
        }
        request.onSwitched?.();
        return true;
      }
      if (focusAfterOrgId === orgId) {
        focusAfterOrgId = null;
      }
      // Before the switchers are let go, so none opens an org itself.
      if (kind === "open") {
        setOfferedOrg({ id: orgId, name });
      }
      release();
      showFailure(say.failure(name), { ...request, kind }, id);
      return false;
    });
}

/**
 * For a switch made outside the switchers (after leaving or deleting the
 * active org) that could not open `org`: the switchers offer it, and the
 * failure is said as the switchers' own are, with Try again. Call while
 * holding the switchers.
 */
export function reportOpenFailure(
  org: OfferedOrg,
  message: string,
  start: () => Promise<boolean>
): void {
  setOfferedOrg(org);
  showFailure(message, {
    orgId: org.id,
    name: org.name,
    start,
    announce: true,
    kind: "open",
  });
}

// How loading the active org and the list again went.
export type OrgLoad = { org: boolean; list: boolean };

/**
 * Loads the active org and the list again after either could not be loaded
 * (`load` resolves to which now could), under the lock and always said: its
 * progress, then that both loaded, or a failure with Try again (the list's
 * own, reloading only it with `reloadList`, where only the list failed).
 * With `refocus`, focus goes to the switcher once an org shows.
 */
export function runOrgLoad(
  load: () => Promise<OrgLoad>,
  refocus: boolean,
  reloadList: () => Promise<boolean>
): Promise<boolean | null> {
  if (holders > 0) {
    return Promise.resolve(null);
  }
  reloadingOrg = true;
  hold();
  if (lastSwitchToast !== undefined) {
    toast.dismiss(lastSwitchToast);
    lastSwitchToast = undefined;
  }
  const id = toast.loading("Loading your organization...");
  if (refocus) {
    focusAfterOrgId = ANY_ORG;
  }
  return Promise.resolve()
    .then(load)
    .catch((error: unknown): OrgLoad => {
      console.error("[OrgSwitcher] Load failed", error);
      return { org: false, list: false };
    })
    .then(({ org, list }) => {
      reloadingOrg = false;
      // None active after all (it is gone): the switchers open one,
      // announced in place of this, and the focus request stands for it, as
      // the button that had focus is gone. Noted before they are let go.
      const noneActive = org && list && currentActiveOrgId() === undefined;
      if (noneActive) {
        announceNextOpen = true;
      }
      release();
      if (org && list) {
        if (noneActive) {
          toast.dismiss(id);
        } else {
          lastSwitchToast = toast.success("Loaded your organization", { id });
        }
        return true;
      }
      if (org) {
        // The active org loaded (and shows, if there is one); only the list
        // did not: said as a link's is, with a Try again that loads it.
        toast.dismiss(id);
        lastSwitchToast = undefined;
        reportLinkProblem("listFailed", reloadList);
        return false;
      }
      if (focusAfterOrgId === ANY_ORG) {
        focusAfterOrgId = null;
      }
      lastSwitchToast = toast.error("Couldn't load your organization.", {
        id,
        duration: 12_000,
        action: {
          label: "Try again",
          onClick: () => {
            // Not once an org shows (loaded some other way meanwhile).
            if (currentActiveOrgId() === undefined) {
              runOrgLoad(load, true, reloadList);
            }
          },
        },
      });
      return false;
    });
}

// What a link to an org (a settings page's, a digest email's) says when it
// cannot switch to it.
const LINK_PROBLEM = {
  notMember: "You're not a member of that organization.",
  listFailed: "Couldn't load your organizations.",
};

/**
 * For a link to an org that cannot be switched to: says why, in place of the
 * last switch's toast and as long as a failure. Where the list failed to
 * load, with Try again, which reloads it (`reload`, resolving to whether it
 * loaded) and says so: the link goes on once it has, and a list that fails
 * again is said again. Not where the user is not in the org.
 */
export function reportLinkProblem(
  problem: keyof typeof LINK_PROBLEM,
  reload?: () => Promise<boolean>
): void {
  if (lastSwitchToast !== undefined) {
    toast.dismiss(lastSwitchToast);
  }
  lastSwitchToast = toast.error(LINK_PROBLEM[problem], {
    duration: 12_000,
    action: reload
      ? {
          label: "Try again",
          onClick: () => {
            reloadForLink(reload);
          },
        }
      : undefined,
  });
}

function reloadForLink(reload: () => Promise<boolean>): void {
  if (lastSwitchToast !== undefined) {
    toast.dismiss(lastSwitchToast);
  }
  const id = toast.loading("Loading your organizations...");
  lastSwitchToast = id;
  reload()
    .catch(() => false)
    .then((loaded) => {
      if (loaded) {
        toast.dismiss(id);
        if (lastSwitchToast === id) {
          lastSwitchToast = undefined;
        }
        return;
      }
      reportLinkProblem("listFailed", reload);
    });
}

/**
 * Back to a fresh page load. For tests: they share this module, and loading a
 * fresh copy of it would also load a second React.
 */
export function resetOrgSwitchState(): void {
  holders = 0;
  offeredOrg = null;
  focusAfterOrgId = null;
  reloadingOrg = false;
  announceNextOpen = false;
  switcherOffering = false;
  lastSwitchToast = undefined;
  activeOrgId = null;
  notify();
}
