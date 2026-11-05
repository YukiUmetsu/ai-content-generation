/** Technology vocabulary: infrastructure, devices, data, security and
 * software-delivery concepts. Generic only: no vendor logos, product names,
 * real hostnames, keys or credentials are modelled or drawn.
 */
import { domainRevealProgress, resolveDomainObject } from "./domain-object-model";
import type { DomainObjectSpec, ResolvedDomainObject } from "./domain-object-model";

export const TECHNOLOGY_OBJECTS=[
  {kind:"server-rack",title:"Server rack",archetype:"rack"},
  {kind:"router",title:"Network router",archetype:"network"},
  {kind:"database",title:"Database",archetype:"datastore"},
  {kind:"storage-disk",title:"Storage disk",archetype:"datastore"},
  {kind:"cloud",title:"Cloud",archetype:"cloud"},
  {kind:"api",title:"API connector",archetype:"connector"},
  {kind:"laptop",title:"Laptop",archetype:"device"},
  {kind:"mobile-phone",title:"Mobile phone",archetype:"device"},
  {kind:"cpu",title:"Processor",archetype:"chip"},
  {kind:"ai-model",title:"AI model",archetype:"neural"},
  {kind:"padlock",title:"Security lock",archetype:"security"},
  {kind:"security-key",title:"Security key",archetype:"security"},
  {kind:"code-terminal",title:"Code terminal",archetype:"window"},
  {kind:"container",title:"Container",archetype:"package"},
  {kind:"user-identity",title:"User identity",archetype:"identity"},
  {kind:"settings",title:"Settings",archetype:"gear"},
  {kind:"bug",title:"Software bug",archetype:"defect"},
  {kind:"git-branch",title:"Version branch",archetype:"version-control"},
] as const;
export type TechnologyObjectKind=typeof TECHNOLOGY_OBJECTS[number]["kind"];
export type TechnologyObjectArchetype=typeof TECHNOLOGY_OBJECTS[number]["archetype"];
export type TechnologyObjectSpec=DomainObjectSpec<TechnologyObjectKind>;
export type ResolvedTechnologyObject=ResolvedDomainObject<TechnologyObjectKind,TechnologyObjectArchetype>;

export function resolveTechnologyObject(spec:TechnologyObjectSpec):ResolvedTechnologyObject {
  return resolveDomainObject("technology",TECHNOLOGY_OBJECTS,spec);
}
export const technologyObjectProgress=domainRevealProgress;
