import type { State, Transition } from "./model";

export interface Notifications {
  findIssue(marker: string): Promise<number | undefined>;
  openIssue(marker: string, at: string): Promise<number>;
  closeIssue(number: number): Promise<void>;
  postNtfy(transition: Transition): Promise<void>;
}

export async function notify(state: State, api: Notifications, persist: () => Promise<void>, log: (text: string) => void) {
  for (const transition of state.transitions) {
    const incident = state.incidents.find((i) => i.id === transition.incident_id)!;
    if (transition.issue === "pending") {
      try {
        const marker = `<!-- home-cloud:${incident.id} -->`;
        incident.issue_number ??= await api.findIssue(marker);
        if (!incident.issue_number) incident.issue_number = await api.openIssue(marker, incident.opened_at);
        if (transition.kind === "recover") await api.closeIssue(incident.issue_number);
        transition.issue = "sent";
        await persist();
      } catch {
        log("Issue delivery pending; a later run will reconcile the transition.");
      }
    }
    if (transition.ntfy === "claimed") {
      transition.ntfy = "uncertain";
      await persist();
    }
    if (transition.ntfy === "pending") {
      // ntfy cannot deduplicate a retried POST after a lost response. Claim durably for at-most-once dispatch.
      transition.ntfy = "claimed";
      await persist();
      try {
        await api.postNtfy(transition);
        transition.ntfy = "sent";
      } catch {
        transition.ntfy = "uncertain";
        log("Push outcome uncertain; automatic resend suppressed to prevent duplicate notifications.");
      }
      await persist();
    }
  }
}

export function githubNotifications(repository: string, token: string, topic: string | undefined, transport: (input: string | URL, init?: RequestInit) => Promise<Response> = fetch): Notifications {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error("Repository and GitHub token are required for delivery.");
  async function request(path: string, method = "GET", body?: unknown): Promise<any> {
    const response = await transport(`https://api.github.com/repos/${repository}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("GitHub delivery failed."); }
    return response.json();
  }
  return {
    async findIssue(marker) {
      // Listing both states reconciles a successful create whose response or checkpoint was lost.
      for (let page = 1; ; page++) {
        const issues = await request(`/issues?state=all&per_page=100&page=${page}`);
        const issue = issues.find((i: any) => !i.pull_request && i.user?.login === "github-actions[bot]" && i.body?.includes(marker));
        if (issue) return issue.number;
        if (issues.length < 100) return undefined;
      }
    },
    async openIssue(marker, at) {
      return (await request("/issues", "POST", {
        title: "Home cloud — unreachable",
        body: `${marker}\n\nThe external check confirmed unreachability at ${at} after three consecutive failed observations. No cause is inferred. This issue closes after two consecutive successful observations.`,
      })).number;
    },
    async closeIssue(number) { await request(`/issues/${number}`, "PATCH", { state: "closed", state_reason: "completed" }); },
    async postNtfy(transition) {
      if (!topic) throw new Error("Push destination is not configured.");
      const url = new URL(topic);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid push destination.");
      const response = await transport(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Title: transition.kind === "open" ? "Home cloud unreachable" : "Home cloud recovered" },
        body: transition.kind === "open" ? "Three external checks failed. Check the public status page." : "Two external checks passed. Reachability recovered.",
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Push delivery failed.");
    },
  };
}
