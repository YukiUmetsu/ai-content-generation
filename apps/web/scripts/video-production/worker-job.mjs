/** One piece of local work owned as a single-node job in the Rust Jobs system: claimed, kept
 * alive by heartbeats, then marked succeeded, failed or cancelled. A crashed worker leaves a
 * recoverable attempt, never a fake success. Used by scene previews and kanji shorts.
 */
const lower = (name) => name.charAt(0).toLowerCase() + name.slice(1);

/** The Jobs server could not be reached before any work was claimed: the caller may run the work untracked. */
export class JobsUnavailableError extends Error {
  constructor(message) { super(message); this.name = "JobsUnavailableError"; this.code = "JOBS_UNAVAILABLE"; }
}

/**
 * @param {{name:string,jobKind:string,idempotencyKey:string,nodeKey:string,nodeKind:string,input:object,signal?:AbortSignal,
 *   output:(result:any)=>object,failure:{errorCode:string,errorDetail:string}}} spec
 *   `name` words the messages ("Scene preview"); `output` checks the work's result and returns what Jobs records (or throws);
 *   `failure` is what Jobs records of a failure (never the raw error, which can carry provider details).
 * @param {(context:{signal:AbortSignal,jobId:string})=>Promise<any>} work
 */
export async function withWorkerJob(spec, work, {
  origin = process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787", fetcher = globalThis.fetch, heartbeatMs = 20_000 } = {}) {
  const { name, signal } = spec;
  const server = new URL(origin);
  if (server.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(server.hostname) ||
    server.username || server.password || server.pathname !== "/" || server.search || server.hash ||
    !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 10 || heartbeatMs > 120_000)
    throw Error(`${name} Jobs must use the local Rust Jobs server.`);
  let claimed = false;
  async function request(path, body) {
    let response;
    try {
      response = await fetcher(new URL(path, server), { method: "POST",
        headers: { "Content-Type": "application/json", "X-Contentgen-Worker": "local-only" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch {
      const message = `${name} Jobs unavailable. Start the local Rust server and retry.`;
      throw claimed ? Error(message) : new JobsUnavailableError(message);
    }
    let data; try { data = await response.json(); } catch { throw Error(`${name} Jobs returned an unreadable result.`); }
    if (!response.ok) throw Error(typeof data.error === "string" ? data.error : data.error?.message ?? `${name} Jobs returned HTTP ${response.status}.`);
    return data;
  }
  if (signal?.aborted) throw signal.reason ?? Error(`${name} cancelled.`);
  let saved = await request("/api/jobs", { jobKind: spec.jobKind, idempotencyKey: spec.idempotencyKey,
    nodes: [{ nodeKey: spec.nodeKey, nodeKind: spec.nodeKind, maxAttempts: 3, input: spec.input, dependsOn: [] }] });
  const jobId = saved.job?.id, nodeId = saved.nodes?.[0]?.id;
  if (typeof jobId !== "string" || typeof nodeId !== "string" || saved.nodes?.[0]?.nodeKey !== spec.nodeKey)
    throw Error(`Rust Jobs did not create the ${lower(name)} attempt.`);
  claimed = true;
  if (saved.created !== true && saved.nodes[0].state === "RUNNING") saved = await request(`/api/jobs/${jobId}/recover-stale`, {});
  if (["FAILED", "CANCELLED"].includes(saved.job?.state)) saved = await request(`/api/jobs/${jobId}/retry`, {});
  if (saved.job?.state !== "RUNNING" || saved.nodes?.[0]?.state !== "READY") throw Error(`This ${lower(name)} is already running or completed in Jobs.`);
  const attempt = await request(`/api/jobs/${jobId}/nodes/${nodeId}/start`, {});
  const attemptId = attempt.attempt?.id;
  if (typeof attemptId !== "string") throw Error(`Jobs did not confirm the ${lower(name)} worker claim.`);
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  let stopped = false, busy = false, leaseError = null;
  const timer = setInterval(async () => {
    if (stopped || busy) return; busy = true;
    try {
      const reply = await request(`/api/jobs/${jobId}/nodes/${nodeId}/heartbeat`, { attemptId });
      if (reply.alive !== true) throw Error(`${name} worker ownership expired.`);
    } catch {
      if (!stopped && !leaseError) { leaseError = Error(`${name} worker lost its Jobs claim. Retry to resume safely.`); abort.abort(leaseError); }
    } finally { busy = false; }
  }, heartbeatMs);
  timer.unref?.();
  try {
    if (combined.aborted) throw combined.reason ?? Error(`${name} cancelled.`);
    const result = await work({ signal: combined, jobId });
    if (leaseError) throw leaseError;
    if (combined.aborted) throw combined.reason ?? Error(`${name} cancelled.`);
    const output = spec.output(result);
    stopped = true; clearInterval(timer);
    await request(`/api/jobs/${jobId}/nodes/${nodeId}/succeed`, { attemptId, output });
    return { result, jobId };
  } catch (error) {
    stopped = true; clearInterval(timer);
    if (leaseError) throw leaseError;
    if (signal?.aborted) { await request(`/api/jobs/${jobId}/cancel`, {}); throw error; }
    await request(`/api/jobs/${jobId}/nodes/${nodeId}/fail`, { attemptId, ...spec.failure });
    throw error;
  } finally { stopped = true; clearInterval(timer); }
}
