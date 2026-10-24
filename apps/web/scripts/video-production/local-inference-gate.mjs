/** One heavyweight local-model request at a time across all Vite Studio jobs. */
let tail = Promise.resolve();
export async function withLocalInference(action, signal) {
  const previous = tail;
  let release;
  tail = new Promise(resolve => {release = resolve;});
  let onAbort;
  const cancelled = signal && new Promise((_,reject) => {
    onAbort = () => reject(signal.reason ?? Error("Local AI task cancelled."));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort",onAbort,{once:true});
  });
  try {
    await (cancelled ? Promise.race([previous,cancelled]) : previous);
    if (signal?.aborted) throw signal.reason ?? Error("Local AI task cancelled.");
    // A provider which ignores abort must not permanently block all later jobs.
    return await (cancelled ? Promise.race([action(),cancelled]) : action());
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort",onAbort);
    release();
  }
}
