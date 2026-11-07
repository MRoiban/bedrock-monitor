import { BedrockError, type DetachedContext } from "bedrock";
import { limitedText } from "./daemon";
export const ARCHIVE_REPO = "MRoiban/Lich";
export interface ArchiveRow {
  pebble: string;
  at: number;
  state: string;
}
export function archiveFile(rows: ArchiveRow[]) {
  const sorted = [...rows].sort(
    (a, b) => a.at - b.at || a.pebble.localeCompare(b.pebble),
  );
  const bytes = Bun.gzipSync(
    sorted.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const day = new Date(sorted[0]!.at).toISOString().slice(0, 10);
  return {
    path: `monitor/${day}/${hash}.jsonl.gz`,
    content: Buffer.from(bytes).toString("base64"),
  };
}
// Archived rows name private pebbles, so every upload first proves the repository is still private:
// a renamed, recreated or flipped-public repository must not receive them.
async function requirePrivate(headers: Record<string, string>, transport: typeof fetch) {
  const r = await transport(`https://api.github.com/repos/${ARCHIVE_REPO}`, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const value = r.ok ? JSON.parse(await limitedText(r, 1024 ** 2)) : (await r.body?.cancel(), null);
  if (value?.private !== true || String(value.full_name).toLowerCase() !== ARCHIVE_REPO.toLowerCase())
    throw new BedrockError(
      "ARCHIVE_NOT_PRIVATE",
      "The check archive repository is not confirmed private.",
      `Make ${ARCHIVE_REPO} private (and the token able to read its metadata); local results remain retained.`,
    );
}
export async function uploadArchive(
  rows: ArchiveRow[],
  token: string,
  transport: typeof fetch = fetch,
) {
  const file = archiveFile(rows),
    url = `https://api.github.com/repos/${ARCHIVE_REPO}/contents/${file.path}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
  const existing = async () => {
    const r = await transport(url, {
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (r.status === 404) {
      await r.body?.cancel();
      return false;
    }
    if (!r.ok)
      throw new BedrockError(
        "ARCHIVE_UNAVAILABLE",
        "Private archive could not be inspected.",
        "Check the GitHub token's Contents permission on MRoiban/Lich.",
      );
    const value = JSON.parse(await limitedText(r, 2 * 1024 ** 2));
    if (
      value.encoding !== "base64" ||
      String(value.content).replace(/\s/g, "") !== file.content
    )
      throw new BedrockError(
        "ARCHIVE_CONFLICT",
        "Archive content does not match its immutable path.",
        "Inspect the private archive before retrying; existing files are never overwritten.",
      );
    return true;
  };
  await requirePrivate(headers, transport);
  if (await existing()) return file.path;
  const r = await transport(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "chore(monitor): archive dated check results",
      content: file.content,
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok) {
    await r.body?.cancel();
    if ((r.status === 409 || r.status === 422) && (await existing()))
      return file.path;
    throw new BedrockError(
      "ARCHIVE_UPLOAD_FAILED",
      "Private check archive was not accepted.",
      "Check the GitHub token and MRoiban/Lich default branch; local results remain retained.",
    );
  }
  await r.body?.cancel();
  // Read back before deleting local evidence; a response alone is not archive verification.
  if (!(await existing()))
    throw new BedrockError(
      "ARCHIVE_UNVERIFIED",
      "Uploaded archive could not be verified.",
      "Retry later; local results have not been deleted.",
    );
  return file.path;
}
let pending: Promise<{ rows: number; files: number }> | undefined;
export async function archive(ctx: DetachedContext) {
  if (pending) return pending;
  if (
    process.env.MONITOR_ARCHIVE_ENABLED !== "1" ||
    !process.env.MONITOR_ARCHIVE_GITHUB_TOKEN
  )
    throw new BedrockError(
      "ARCHIVE_NOT_CONFIGURED",
      "Private archive export is not enabled.",
      "Set MONITOR_ARCHIVE_ENABLED=1 and MONITOR_ARCHIVE_GITHUB_TOKEN with Contents write permission on MRoiban/Lich, then restart.",
    );
  const token = process.env.MONITOR_ARCHIVE_GITHUB_TOKEN;
  pending = (async () => {
    const cutoff = Date.now() - 14 * 86400000;
    let total = 0,
      files = 0;
    // Bounded batches leave write slots free during compression and GitHub requests.
    for (let batch = 0; batch < 32; batch++) {
      const rows = await ctx.read(({ db }) =>
        db.$client
          .query<
            ArchiveRow,
            [number]
          >("SELECT pebble,at,state FROM monitor_results WHERE at<? ORDER BY at,pebble LIMIT 1000")
          .all(cutoff),
      );
      if (!rows.length) break;
      await uploadArchive(rows, token);
      await ctx.write(({ db, invalidate }) => {
        for (const row of rows)
          db.$client.run(
            "DELETE FROM monitor_results WHERE pebble=? AND at=?",
            [row.pebble, row.at],
          );
        invalidate(["monitor_results"]);
      });
      total += rows.length;
      files++;
    }
    return { rows: total, files };
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
