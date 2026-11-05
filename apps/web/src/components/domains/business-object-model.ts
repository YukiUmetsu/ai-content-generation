/** Business operations and organization vocabulary. Monetary business
 * objects (storefront, briefcase, handshake, corporate office, …) remain in
 * the finance vocabulary; this pack covers people, planning, process and
 * logistics concepts. Generic only: no company names, logos or real data.
 */
import { domainRevealProgress, resolveDomainObject } from "./domain-object-model";
import type { DomainObjectSpec, ResolvedDomainObject } from "./domain-object-model";

export const BUSINESS_OBJECTS=[
  {kind:"org-chart",title:"Org chart",archetype:"hierarchy"},
  {kind:"team",title:"Team",archetype:"people"},
  {kind:"meeting",title:"Meeting",archetype:"people"},
  {kind:"presentation",title:"Presentation",archetype:"board"},
  {kind:"kpi-dashboard",title:"KPI dashboard",archetype:"board"},
  {kind:"target",title:"Target",archetype:"goal"},
  {kind:"milestone",title:"Milestone",archetype:"goal"},
  {kind:"deadline",title:"Deadline",archetype:"schedule"},
  {kind:"workflow",title:"Workflow",archetype:"flow"},
  {kind:"checklist",title:"Checklist",archetype:"task"},
  {kind:"idea",title:"Idea",archetype:"insight"},
  {kind:"megaphone",title:"Announcement",archetype:"broadcast"},
  {kind:"global-market",title:"Global market",archetype:"globe"},
  {kind:"delivery-truck",title:"Delivery truck",archetype:"logistics"},
  {kind:"shipping-box",title:"Shipping box",archetype:"logistics"},
  {kind:"warehouse",title:"Warehouse",archetype:"facility"},
  {kind:"factory",title:"Factory",archetype:"facility"},
] as const;
export type BusinessObjectKind=typeof BUSINESS_OBJECTS[number]["kind"];
export type BusinessObjectArchetype=typeof BUSINESS_OBJECTS[number]["archetype"];
export type BusinessObjectSpec=DomainObjectSpec<BusinessObjectKind>;
export type ResolvedBusinessObject=ResolvedDomainObject<BusinessObjectKind,BusinessObjectArchetype>;

export function resolveBusinessObject(spec:BusinessObjectSpec):ResolvedBusinessObject {
  return resolveDomainObject("business",BUSINESS_OBJECTS,spec);
}
export const businessObjectProgress=domainRevealProgress;
