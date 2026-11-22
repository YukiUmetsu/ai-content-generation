import assert from "node:assert/strict";
import test from "node:test";
import { JobsUnavailableError, withWorkerJob } from "./worker-job.mjs";

const spec = (extra = {}) => ({ name: "Test work", jobKind: "video-test", idempotencyKey: "k", nodeKey: "n", nodeKind: "video.test", input: {},
  output: (result) => ({ ok: result }), failure: { errorCode: "test_failed", errorDetail: "Stopped." }, ...extra });
function jobs({ fail = {} } = {}) {
  const calls = [];
  const fetcher = async (url) => {
    const path = new URL(url).pathname, last = path.split("/").at(-1);
    calls.push(last);
    if (fail[last]) return fail[last]();
    const reply = path === "/api/jobs" ? { created: true, job: { id: "j", state: "RUNNING" }, nodes: [{ id: "n1", nodeKey: "n", state: "READY" }] }
      : last === "start" ? { attempt: { id: "a" } } : { success: true };
    return { ok: true, json: async () => reply };
  };
  return { calls, fetcher };
}

test("an unreachable Jobs server before any claim is JobsUnavailableError, so the caller may run untracked", async () => {
  await assert.rejects(withWorkerJob(spec(), async () => 1, { fetcher: async () => { throw Error("refused"); } }), JobsUnavailableError);
});

test("the work's own error is kept when recording the failure in Jobs fails too", async () => {
  const { calls, fetcher } = jobs({ fail: { fail: async () => { throw Error("refused"); } } });
  await assert.rejects(withWorkerJob(spec(), async () => { throw Error("ffmpeg exited 1"); }, { fetcher }), /ffmpeg exited 1/u);
  assert.ok(calls.includes("fail"));
});

test("finished work whose success Jobs cannot record is retried, and never recorded as failed", async () => {
  const { calls, fetcher } = jobs({ fail: { succeed: async () => ({ ok: false, status: 500, json: async () => ({ error: "locked" }) }) } });
  await assert.rejects(withWorkerJob(spec(), async () => 1, { fetcher, retryMs: 1 }), /locked/u);
  assert.equal(calls.filter(call => call === "succeed").length, 3);
  assert.equal(calls.includes("fail"), false);
  // A refusal that passes is recorded on the next try.
  let refused = 0;
  const flaky = jobs({ fail: { succeed: async () => refused++ ? { ok: true, json: async () => ({ success: true }) } : { ok: false, status: 500, json: async () => ({ error: "locked" }) } } });
  assert.equal((await withWorkerJob(spec(), async () => 2, { fetcher: flaky.fetcher, retryMs: 1 })).result, 2);
});

test("with keepFinishedWork, a cancel that arrives as the work finishes still records the success", async () => {
  const abort = new AbortController();
  const { calls, fetcher } = jobs();
  const { result } = await withWorkerJob(spec({ signal: abort.signal, keepFinishedWork: true }), async () => { abort.abort(Error("late cancel")); return 7; }, { fetcher });
  assert.equal(result, 7);
  assert.ok(calls.includes("succeed"));
  assert.equal(calls.includes("cancel"), false);
  // Without it, the same late cancel is a cancellation.
  const other = new AbortController(), second = jobs();
  await assert.rejects(withWorkerJob(spec({ signal: other.signal }), async () => { other.abort(Error("late cancel")); return 7; }, { fetcher: second.fetcher }), /late cancel/u);
  assert.ok(second.calls.includes("cancel"));
});
