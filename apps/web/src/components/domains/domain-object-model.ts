/** Shared, renderer-neutral vocabulary contract for domain object packs
 * (business, technology, …). Each semantic `kind` maps to a reusable
 * `archetype`; a spec carries a stable semantic ID and optional title/accent.
 * No brand marks, vendor names, credentials or account data are modelled.
 */
export interface DomainObjectDescriptor<K extends string=string,A extends string=string> {
  readonly kind:K;
  readonly title:string;
  readonly archetype:A;
}
export type DomainObjectState="idle"|"active"|"complete";
export interface DomainObjectSpec<K extends string=string> {
  kind:K;
  /** Stable ASCII semantic ID used for narration, linking and export. */
  id:string;
  /** Visible title (1–52 characters). Defaults to the catalog title. */
  title?:string;
  /** Optional accent override, six-digit hex. */
  accent?:string;
  /** Conceptual state shown as a non-text ring; never fake progress. */
  state?:DomainObjectState;
}
export interface ResolvedDomainObject<K extends string=string,A extends string=string>
  extends DomainObjectSpec<K> {
  title:string;
  archetype:A;
}
const STATES:readonly DomainObjectState[]=["idle","active","complete"];

/** Validate a spec against a catalog. Throws a descriptive error for unknown
 * kinds, unstable IDs, empty/overlong titles, malformed accents and states.
 */
export function resolveDomainObject<K extends string,A extends string>(
  domain:string,
  catalog:readonly DomainObjectDescriptor<K,A>[],
  spec:DomainObjectSpec<K>,
):ResolvedDomainObject<K,A> {
  const descriptor=catalog.find(entry=>entry.kind===spec?.kind);
  if(!descriptor)
    throw new Error(`Unsupported ${domain} object kind ${JSON.stringify(spec?.kind)}. `+
      `Use one of: ${catalog.map(entry=>entry.kind).join(", ")}.`);
  if(!spec.id||!/^[-a-zA-Z0-9_]{1,72}$/.test(spec.id))
    throw new Error(`${capitalize(domain)} object needs a stable ASCII semantic ID (1–72 characters).`);
  const title=spec.title??descriptor.title;
  if(typeof title!=="string"||!title.trim()||title.length>52)
    throw new Error(`${capitalize(domain)} object title must be 1–52 characters.`);
  if(spec.accent!==undefined&&!/^#[0-9A-Fa-f]{6}$/.test(spec.accent))
    throw new Error(`${capitalize(domain)} object accent must be six-digit hex.`);
  if(spec.state!==undefined&&!STATES.includes(spec.state))
    throw new Error(`Unsupported ${domain} object state.`);
  return {...spec,title,archetype:descriptor.archetype};
}

/** Absolute-frame smoothstep reveal shared by every domain pack. */
export function domainRevealProgress(frame:number,startFrame=0,durationFrames=20):number {
  if(!Number.isSafeInteger(frame)||!Number.isSafeInteger(startFrame)||
     !Number.isSafeInteger(durationFrames)||durationFrames<1||startFrame<0)
    throw new Error("Domain object reveal requires integer absolute frames.");
  const t=Math.max(0,Math.min(1,(frame-startFrame)/durationFrames));
  return t*t*(3-2*t);
}
function capitalize(value:string):string {
  return value.charAt(0).toUpperCase()+value.slice(1);
}
