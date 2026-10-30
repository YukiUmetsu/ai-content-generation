/** Exact, single-clock synchronization for 48 kHz speech, captions, scene events and SFX. */
export const AUDIO_SAMPLE_RATE = 48000;

const validInteger = (v, min) => Number.isSafeInteger(v) && v >= min;
const fail = (message) => { throw new Error(`Invalid sample timeline: ${message}`); };

function checkFps(fps) {
  if (!fps || !validInteger(fps.num, 1) || !validInteger(fps.den, 1) || fps.num / fps.den > 120) fail("fps must be a positive rational up to 120 frames/s");
}

/** Convert absolute audio position into a video frame; round at the last operation only. */
export function toFrame(sample, fps) {
  checkFps(fps);
  if (!validInteger(sample, 0)) fail("sample position must be a nonnegative safe integer");
  const numerator = BigInt(sample) * BigInt(fps.num);
  const denominator = BigInt(AUDIO_SAMPLE_RATE) * BigInt(fps.den);
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) fail("frame position exceeds safe integer range");
  return Number(rounded);
}

/** Keep measured speech intact; add the minimum whole milliseconds of silence
 * only when a narrated scene would otherwise occupy zero video frames. */
export function fitSceneDurations(beats, {fps} = {}) {
  checkFps(fps);
  if (!Array.isArray(beats) || !beats.length) fail("narrated beats are required");
  let cursor=0;
  const adjustments=[];
  const fitted=beats.map(beat=>{
    if(!beat || typeof beat.id!=="string" || !beat.id.trim() || !validInteger(beat.samples,1) ||
      !validInteger(beat.pauseAfterMs,0) || beat.pauseAfterMs>60000)
      fail(`invalid measured scene ${typeof beat?.id==="string"?beat.id:"(unknown)"}`);
    let pause=beat.pauseAfterMs;
    while(toFrame(cursor+beat.samples+pause*48,fps)<=toFrame(cursor,fps)){
      if(pause>=60000)fail(`scene ${beat.id} cannot fit a video frame within the silence limit`);
      pause++;
    }
    const end=cursor+beat.samples+pause*48;
    if(!Number.isSafeInteger(end))fail("timeline exceeds safe sample range");
    cursor=end;
    if(pause===beat.pauseAfterMs)return beat;
    adjustments.push({id:beat.id,addedPauseMs:pause-beat.pauseAfterMs});
    return {...beat,pauseAfterMs:pause};
  });
  return {beats:adjustments.length?fitted:beats,adjustments};
}

/**
 * @param {Array<{id:string,samples:number,pauseAfterMs:number,eventIds?:string[]}>} beats
 * @param {{fps:{num:number,den:number},events:Array<{id:string,beatId:string}>}} options
 */
export function buildSampleTimeline(beats, { fps, events = [] } = {}) {
  checkFps(fps);
  if (!Array.isArray(beats) || beats.length === 0) fail("narrated beats are required");
  if (!Array.isArray(events)) fail("events must be an array");
  const seenBeats = new Set(), byId = new Map();
  const ranges = [];
  let cursor = 0;
  for (const beat of beats) {
    if (!beat || typeof beat.id !== "string" || !beat.id.trim()) fail("missing beat ID");
    if (seenBeats.has(beat.id)) fail(`duplicate beat ID ${beat.id}`);
    seenBeats.add(beat.id);
    if (!validInteger(beat.samples, 1)) fail(`beat ${beat.id} must have positive measured samples`);
    if (!validInteger(beat.pauseAfterMs, 0) || beat.pauseAfterMs > 60000) fail(`beat ${beat.id} has an invalid pause`);
    if (beat.eventIds !== undefined && (!Array.isArray(beat.eventIds) || new Set(beat.eventIds).size !== beat.eventIds.length)) fail(`beat ${beat.id} has duplicate or invalid event IDs`);
    const endSample = cursor + beat.samples;
    const pauseEndSample = endSample + beat.pauseAfterMs * 48;
    if (!Number.isSafeInteger(pauseEndSample)) fail("timeline exceeds safe sample range");
    const range = Object.freeze({
      id: beat.id, startSample: cursor, endSample, pauseEndSample,
      startFrame: toFrame(cursor, fps), endFrame: toFrame(endSample, fps),
      pauseEndFrame: toFrame(pauseEndSample, fps),
    });
    ranges.push(range);
    byId.set(beat.id, { beat, range });
    cursor = pauseEndSample;
  }

  const eventSamples = Object.create(null);
  const eventFrames = Object.create(null);
  for (const event of events) {
    if (!event || typeof event.id !== "string" || !event.id.trim()) fail("invalid event ID");
    if (Object.hasOwn(eventSamples, event.id)) fail(`duplicate event ${event.id}`);
    const found = byId.get(event.beatId);
    if (!found) fail(`orphan event ${event.id} points to missing beat ${event.beatId}`);
    if (!(found.beat.eventIds ?? []).includes(event.id)) fail(`event ${event.id} is unregistered on beat ${event.beatId}`);
    eventSamples[event.id] = found.range.startSample;
    eventFrames[event.id] = found.range.startFrame;
  }
  for (const beat of beats) for (const eventId of beat.eventIds ?? []) {
    if (!Object.hasOwn(eventSamples, eventId)) fail(`orphan/unregistered event ${eventId} on beat ${beat.id}`);
  }
  return Object.freeze({
    sampleRate: AUDIO_SAMPLE_RATE,
    fps: Object.freeze({ num: fps.num, den: fps.den }),
    beats: Object.freeze(ranges), eventSamples: Object.freeze({ ...eventSamples }),
    eventFrames: Object.freeze({ ...eventFrames }), totalSamples: cursor, totalFrames: toFrame(cursor, fps),
  });
}

function timecode(sample) {
  const millis = Math.round(sample / 48);
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor(millis / 60000) % 60;
  const seconds = Math.floor(millis / 1000) % 60;
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** Beat-level SRT only. Do not pretend we have word-level forced alignment. */
export function writeSrt(timeline, beatTexts) {
  if (!timeline || !Array.isArray(timeline.beats)) fail("missing timeline for SRT");
  return timeline.beats.map((beat, index) => {
    const text = beatTexts?.[beat.id];
    if (typeof text !== "string" || !text.trim()) fail(`missing caption text for beat ${beat.id}`);
    if (Math.round(beat.startSample / 48) >= Math.round(beat.endSample / 48)) fail(`beat ${beat.id} is too short for millisecond SRT precision`);
    const safeText = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    return `${index + 1}\n${timecode(beat.startSample)} --> ${timecode(beat.endSample)}\n${safeText}\n`;
  }).join("\n");
}

/** A scene remains one visual chapter while its separately timed voices get
 * accurate, speaker-labeled captions. Legacy single-speaker scenes keep their
 * previous SRT bytes and numbering through the same writeSrt function. */
export function writeSceneSpeechSrt(timeline, speech) {
  if(!Array.isArray(speech)||!Array.isArray(timeline?.beats))fail("scene speech and timeline are required");
  const byId=new Map(speech.map(beat=>[beat.id,beat]));
  if(byId.size!==speech.length)fail("scene speech IDs must be unique");
  const cues=[],texts=Object.create(null);
  for(const range of timeline.beats){
    const scene=byId.get(range.id);
    if(!scene)fail(`missing caption scene ${range.id}`);
    if(!Array.isArray(scene.turns)){
      cues.push(range);texts[range.id]=scene.text;continue;
    }
    if(!scene.turns.length)fail(`scene ${range.id} has no caption turns`);
    let cursor=range.startSample;
    for(const turn of scene.turns){
      if(typeof turn.id!=="string"||!turn.id.trim()||
        !validInteger(turn.samples,1)||!validInteger(turn.pauseAfterMs,0)||turn.pauseAfterMs>3000)
        fail(`scene ${range.id} has an invalid caption turn`);
      const end=cursor+turn.samples;
      if(!Number.isSafeInteger(end)||end>range.endSample)fail(`scene ${range.id} caption exceeds speech time`);
      const name=turn.speakerRole==="character"&&typeof turn.speakerId==="string"&&
        /^[a-zA-Z0-9_-]{1,80}$/u.test(turn.speakerId)?
        turn.speakerId[0].toUpperCase()+turn.speakerId.slice(1):"Narrator";
      const cueId=`${range.id}.${turn.id}`;
      if(Object.hasOwn(texts,cueId))fail(`duplicate caption turn ${cueId}`);
      texts[cueId]=`${name}: ${turn.text}`;
      cues.push({id:cueId,startSample:cursor,endSample:end});
      cursor=end+turn.pauseAfterMs*48;
    }
    if(cursor!==range.endSample)fail(`scene ${range.id} captions disagree with measured speech`);
  }
  return writeSrt({beats:cues},texts);
}
