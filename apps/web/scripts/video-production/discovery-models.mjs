/** Explicit opt-in local model failover shared by graph and candidate jobs. */
import { DEFAULT_RESEARCH_GENERATION,validateResearchModelSettings } from "./research-model-settings.mjs";

export function normalizeDiscoveryModels(value) {
  const selected=value?.primary??value;
  if(!selected?.model)throw Error("Choose a local research model in Settings.");
  const primary=validateResearchModelSettings({...selected,version:1,
    ...(selected.generation?{generation:{...DEFAULT_RESEARCH_GENERATION,...selected.generation}}:{})});
  const secondary=value?.secondary?.model?
    validateResearchModelSettings({...value.secondary,version:1,
      generation:primary.generation??value.secondary.generation}):null;
  return {primary,...(secondary&&
    (secondary.model!==primary.model||secondary.endpoint!==primary.endpoint)?{secondary}:{})};
}

export function discoveryAttemptModels(value) {
  const {primary,secondary}=normalizeDiscoveryModels(value);
  return secondary?[primary,secondary,secondary]:[primary,primary,primary];
}
