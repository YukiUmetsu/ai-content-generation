# Creative Pattern Library: Premium, High-Retention Explainer Videos

**Status:** design/research specification, not implemented runtime code  
**Research snapshot:** 2026-10-21  
**Audience:** coding agents building original educational, documentary, consumer-cost, finance, business, science and engineering videos  
**Use with:** `docs/12-brand-studio.md` (identity), `docs/13-audio-production.md` (sound), `docs/14-kumiki-integration.md` (visual runtime), `docs/15-video-performance-system.md` (research/experiments)

> **Goal:** Standardize *creative decisions and craftsmanship*, not finished videos. No title, composition, animation or palette predicts virality. Prioritize an honest, specific viewer promise, an original explanation, a visible conceptual transformation and measured viewer satisfaction. The patterns below are authoring hypotheses; observational creator examples and survey figures are not causal proof.

## 1. Core creative model

A compelling explainer typically moves through **familiar subject → consequential tension/missing information → investigation or demonstration → changed understanding → qualified payoff**. The subject makes the video accessible; the tension creates a question; evidence and visual change earn attention; a real answer repays it.

**Compile in this order:** `verified topic + audience → curiosity mechanism → title/thumbnail/opening package → answer/payoff + evidence → story engine → scene intentions → BrandKit treatment + audio direction → Kumiki composition → platform-specific render → QA → actual analytics feedback`.

The creative system must not produce a title before establishing a defensible answer or output an expensive full render before the hook and visual payoff can be demonstrated cheaply.

### Four independently useful quality dimensions

1. **Packaging:** does the title/thumbnail pair communicate *one* reason to watch, instantly and accurately?
2. **Narrative:** does each beat change the viewer's question, evidence, prediction, mental model or decision?
3. **Visual pedagogy:** do the objects, transformations, graphs and camera communicate something *not already obvious from captions*?
4. **Brand execution:** is the result recognizable, legible, rights-cleared, appropriately paced and sonically coherent across formats?

Do not collapse these into one fictitious `viralScore`. Deterministic validation, human approval and observed platform outcomes are different kinds of evidence.

## 2. Title grammar: write to the type of curiosity

Choose a **curiosity mechanism** first; generate a **searchable** and an **intriguing** option where suitable. Title length is contextual; important nouns should appear early. Quantities and absolutes require sourced support. The video must directly deliver the implied promise.

| Mechanism | Title family | Example | Required payoff / visual |
|---|---|---|---|
| **Hidden mechanism** | Why `[familiar object]` `[unexpected behavior]` | Why Your Electric Bill Rises When You Use Less | Bill breakdown + fixed/variable charges + condition |
| **Hidden cost** | The Real `[timeframe]` Cost of `[decision]` | The Real 30-Year Cost of a $500,000 House | Source-backed lifetime cost model, ranges and assumptions |
| **Price mystery** | Why `[repair or product]` Costs So Much | Why Replacing a Roof Costs So Much | Real components: material, labor, complexity, overhead |
| **Contradiction** | Why `[expected benefit]` Doesn't `[expected outcome]` | Why New Windows Rarely Pay for Themselves Quickly | Energy savings vs. installation cost, exception cases |
| **Outcome mystery** | Why `[formerly successful thing]` `[failed or changed]` | Why Buffet Chains Suddenly Disappeared | Timeline + causal turning points; avoid fake monocausality |
| **Specific magnitude** | How `[company/system]` Lost/Spent `[amount]` | How an Expansion Project Burned Through $1 Billion | Verified, accurately contextualized allocation/timeline |
| **Unexpected solution** | How `[surprising tool]` Solves `[hard problem]` | How a Simple Valve Prevents a Pipeline Failure | Mechanism + applicability limits |
| **Decision** | `[A]` vs `[B]`: Which Actually `[wins]`? | Heat Pump vs. Gas Furnace: Which Costs Less? | Fair scenarios and threshold where preference changes |
| **Engineering hidden world** | The Hidden Engineering Inside `[object]` | The Hidden Engineering Inside Your Water Heater | Accurate sectional cutaway + physical mechanism |
| **Risk / mistake** | The `[risk]` That Can Cost `[audience]` | The Home Repairs That Can Destroy Your Budget | Risk scenarios, likelihood boundaries, mitigation |

**Useful contrast:** *"How Home Insulation Works"* describes a topic. *"Why More Insulation Doesn't Always Cut Your Bill"* adds an observable contradiction—**but only use it if the evidence supports it**.

**Avoid default title hacks:** `INSANE`, `SHOCKING`, `SECRET`, `PROVEN`, invented universal savings, fake urgency, all caps, manipulative fear, inaccurate comparison. Choosing more emotionally charged adjectives is not meaningful experimentation. For three package candidates, vary **mechanism and creative promise**, not synonyms.

### Title/package validation

- Main object and stakes recognizable to target audience; critical nouns early.
- Promise is specific enough to verify, not just “you won't believe this.”
- Evidence/assumptions can support every concrete number and prediction.
- First 5–30 seconds materially advance the *same question*; ending answers it.
- Candidate packages are substantively distinct: `cost-reveal` versus `mechanism-investigation` versus `decision-showdown`.

## 3. Thumbnail composition grammar: show *the interesting part*

Thumbnails work as tiny visual propositions. A generic HVAC photo says *topic*; an exploded HVAC unit with a highlighted expensive subsystem says *why should I care?*. Title and thumbnail should complement, not paraphrase each other.

| Composition ID | Core geometry | Narrative promise | Typical rendering asset |
|---|---|---|---|
| `hero-object` | One dominant subject; sparse negative space | Familiar object with unexpected stakes | House, roof, router, pump |
| `a-vs-b` | Two equally legible alternatives, one clear comparison axis | Which is better / cheaper / safer? | Gas furnace versus heat pump |
| `exploded-cutaway` | Physical layers pulled apart; coherent part relationships | Hidden complexity or cost | HVAC, foundation, road surface |
| `number-reversal` | Recognizable initial number versus unknown/contradictory result | A surprising magnitude | Purchase price versus modeled lifetime cash flow |
| `before-after` | Same subject, two meaningfully changed states | What happened / why it changed? | Business expansion versus collapse |
| `visual-anomaly` | One credible, strange observable phenomenon | How is that possible? | Road washboarding, water pressure, unusual motion |
| `human-plus-object` | Authentic face / scale reference beside clear item | Human consequences or demonstration | Creator conducting physical experiment |

**Practical layout requirements:**

- One primary focal cluster; optional secondary comparison object; title owns the context.
- Minimize thumbnail text. **0–5 words is a useful starting range**, not a rule. Avoid duplicating the title. The same principle applies to mobile preview legibility of figures.
- Show at realistic small preview sizes (e.g. **160×90** and **320×180**) and also final resolution. Verify actual loaded fonts, critical crop, contrast, safe zones and absence of overlapping labels.
- Prefer a *specific physical object, unusual relationship or defensible number* over decorative arrows, exaggerated expressions or effects. Faces are a legitimate option, not mandatory for faceless channels.
- BrandKit owns palette, typography, icon stroke and material treatment. A strong `attention` color can highlight one idea without making the entire channel neon.
- Create **three meaningfully different concepts**: e.g. (A) lifetime number, (B) component cutaway, (C) two-option break-even. Not three crops, accents or adjective swaps.
- Do not imitate another creator's specific composition or reuse their artwork, recognizable identity or screenshots without rights review.

**Observed, not causal:** In vidIQ's July 2026 study of **500 breakout long-form thumbnails across 30 niches**, **69%** featured a human face, **72%** contained overlay text, **56%** used high contrast, and only **5%** used exaggerated expressions; among thumbnails with text, median length was **five words**. The study sampled breakouts rather than randomized alternatives and cannot prove any feature caused the views. [Study](https://vidiq.com/vi/research/youtube-thumbnail-study/).

## 4. Story engine library: choose before scripting

The narrative engine determines information order and visual proof. Do not force every topic through the same countdown or documentary voice.

| Engine | Narrative states (in order) | Best subject | Main Kumiki composition |
|---|---|---|---|
| `mystery-investigation` | Odd result → competing hypotheses → evidence/test → mechanism → implication | Physical mysteries, daily technology | Hypothesis cards kept subordinate to physical test; progressive reveal |
| `engineering-experiment` | Problem/constraint → prototype → test → observed result → improved model/tradeoff | Infrastructure, HVAC, inventions | Sectional assets, continuous simulations, stateful diagrams |
| `rise-and-fall` | Former success → stress signals → turning point → causal chain → aftermath | Company, market, product history | Timeline, financial/market flows, failure network |
| `cost-revelation` | Sticker price → omitted costs → accumulated total → sensitivities → qualified answer | Home purchase, renovations, insurance | Price split, cost waterfall, cash-flow timeline |
| `decision-showdown` | Two credible options → evaluation criteria → scenario runs → crossover → conditional choice | Rent/buy, heating, solar | Parallel setups with shared chart axes; threshold reveal |
| `failure-investigation` | Real incident → expected safeguard → linked failures → redesign → lesson | Structural/technical failures | Causal propagation, cutaway, before/after redesign |
| `historical-breakthrough` | Old limitation → failed approaches → insight → functioning solution → broader impact | Computing, transportation, science history | Evolving physical model, maps, chronological states |

### Narrative micro-patterns

These are reusable *thinking actions*, not decorative transition presets:

- **Predict → observe → explain:** viewer expects X, demonstration shows Y, causal model resolves discrepancy.
- **Show → isolate → recombine:** show a functioning system, isolate its parts, then show how behavior emerges when the parts interact.
- **Introduce constraint → test solution → reveal tradeoff:** makes engineering progression meaningful.
- **Initial price → incremental costs → sensitivity → decision:** makes numbers actionable.
- **Apparent cause → counterevidence → better cause:** prevents one-factor overclaims.
- **Before → transition → after → consequence:** useful for business history and transformations.

Every major beat should have: `questionOrClaim`, `evidenceRefs`, `beforeState`, `operation`, `afterState`, `semanticObjects`, `eventIds`, `spokenIntent`, `payoffOrCarryQuestion`, `limitations`. Reject empty or superficial transformations unless the beat is an explicitly justified observation/hold.

**Narrative integrity:** all essential open questions must close, every numerical claim is sourced or labeled a scenario, a comparison must use equivalent conditions, and the recap must teach the mechanism/decision rather than list generic verbs. Distinguish observed historical causes, model assumptions and speculation.

## 5. Hooks: first evidence, then momentum

A hook's job is to confirm that the viewer clicked on the right video and create a worthwhile unresolved question. **There is no universal retention-optimal cut interval.** Show the credible subject or demonstration early, and avoid long decorative brand bumpers.

| Hook ID | Opening visual | Good question | Best story engines |
|---|---|---|---|
| `result-first` | Reveal a defensible surprising number/outcome | How could the total be that high? | Cost-revelation, decision-showdown |
| `incident-first` | Show a verified event/failure | How could the system allow this? | Failure-investigation, rise-and-fall |
| `demo-first` | Physically observed unexpected behavior | Why did changing X produce Y? | Engineering-experiment, mystery |
| `contradiction-first` | Two seemingly incompatible facts | Which assumption is wrong? | Mystery, economics, technical decision |
| `stakes-first` | Real decision and plausible consequence | What information would change my choice? | Consumer costs, personal finance |

**Long-form heuristic:** Use the first **0–5 s** for recognizable problem/observation/result; by **30 s**, substantively validate title+thumbnail promise. Then orient briefly, deepen evidence, expose causal mechanism and close with a qualified result. The 30-second marker is useful because YouTube Studio reports introductory retention, not because every opening should have the same duration. [YouTube retention help](https://support.google.com/youtube/answer/9314415).

### Short-form narrative recipes (suggested, adaptable)

| Short ID | Sequence | Visual tempo guidance | Example |
|---|---|---|---|
| `short-cost-shock` | Price/result → hidden cost components → accumulated total → caveat | 1 recognisable object, then linked price transfers | Roof quote disassembled |
| `short-mechanism` | Strange observation → prediction → physical test → simple explanation | Hold long enough to actually see the mechanism | Washboard road formation |
| `short-cross-over` | A vs. B → important variable → live break-even → decision condition | Keep axes/labels stable; animate variable | Heat pump vs. gas furnace |
| `short-myth-test` | Familiar belief → counterexample → evidence → correct bounded claim | Reveal contradictions, avoid smug dismissal | New window payback |
| `short-mistake-fix` | Potential mistake → failure propagation → safer method → verification | Explicit causal failure path | Incorrect waterproofing |
| `short-history` | Old constraint → failed approach → breakthrough → impact | Temporal anchors and evolving artifact | Early infrastructure breakthrough |

**Suggested 30–45 s treatment:** establish one recognizable question in the opening **0–3 s**, put the actual proof/result on-screen during the next **10–30 s**, finish with the core answer and boundary. Use 30–45s only as an initial template; evidence and intelligibility dictate the actual runtime. Different platforms have different viewing surfaces, safe areas and capabilities.

**Critical:** a Short is *reauthored* from the semantic story. Do not blind-crop a 16:9 composition, read a long-form script faster, or force suspense where a direct answer is more helpful.

## 6. Visual composition and animation grammar

Use **information transitions**, not transitions for their own sake. For each beat answer: *What should the viewer know after this animation that was not apparent before it?*

| Visual intent | Camera / framing | Semantic scene transformation | Visual guard |
|---|---|---|---|
| `inspect-interior` | Stable 3D perspective; optional controlled section camera | Exterior → exploded components → reassembled mechanism | Critical object remains visible, depth/labels correct |
| `cost-accumulate` | Locked wide view on price + graph | Costs separate, flow into running total; units consistent | Correct sums, axis scale, no unsupported magnitude |
| `compare-conditions` | Stable side-by-side with shared baseline | One variable changes, two outcomes respond | Same assumptions and measurement units |
| `failure-propagate` | Wide physical context, tracked only when necessary | A real failure moves along dependent connections | Named ports/relations and timed path, not random arrows |
| `time-evolution` | Consistent coordinate/map baseline | States evolve over time; turning points marked | Correct time sequence and source dates |
| `graph-plus-machine` | Diagram/graph simultaneously visible | Physical component motion drives data plot | Data and physics synchronized |
| `process-journey` | Locked overview or justified tracking with look-ahead | Identifiable object progresses through actual operations | Camera does not lag, source/destination in view |
| `prediction-observation` | Two synchronized panes, then focus | Expected result vs. measured result → model correction | Clearly labels prediction vs. actual data |
| `household-translation` | Recognizable object/decision context | Abstract figure becomes practical cash/energy/time impact | Transparent assumptions and uncertainty |

**Default camera rule:** for dense diagrams, use a **locked camera**. Use `inspect`, `follow`, `compare`, `reveal-interior`, or `establish-context` only when changing viewpoint makes the mechanism clearer. No unmotivated orbit, tiny-object zoom tracking, reversing camera, delayed subject follow or cropping of key controls. Critical frame checks and text exclusion must reuse **Kumiki's existing** semantic visual constraints, MG1/MD1 and CC1 rather than a second timing/camera system.

**On-screen copy:** most detail belongs in correctly aligned narration and actual visuals. A concise caption may name the current action or conclusion. Keep chart labels/units visible long enough to read. A static hold can be the right instructional choice; do not fail a scene merely for low motion frequency.

**Script interactions:** a general explainer keeps the measured narration clock. A narration window starts at least every 10 seconds and no sooner than 5, unless the scene itself is shorter. After speech is measured, the Local AI chat endpoint already saved in Settings is asked, once per scene, for the objects copied from each window, one action those pictures can already do (show, move, connect, compare, or ring), and one on-screen claim of at most 40 characters using only words from that window. When a prepared photo has a title, that reply can keep it only when the model says keep and the title names a word in the narration. A drop removes the photo. A reply that does not match leaves the photo in place. That call uses the script-task profile, or the default profile when script is left on Use default. A question opens the lens, a step or handoff uses the journey, a contradiction uses contrast, parts of a whole use decomposition, and a result uses synthesis. An example draws a closing ring around one concrete case, a cause sends a marker along the link to the effect, and a warning grows one slow ring on the risk. The model must copy each window. show uses the lens, move uses the journey, connect uses the cause, compare uses contrast, and ring uses the example. A missing model, a non-loopback endpoint, or a reply that does not match the windows leaves the sentence rules in place. An ordinary clause keeps the scene's authored layout. The same job keeps the same picture; the spoken phrase and the photo or clip still move inside it. A running total, a dated timeline, or a prediction beside a measurement waits until the sentence actually contains that evidence. This is not a second timeline and not a rotation through layouts for its own sake.

## 7. Premium palette and branded visual direction

**BrandKit defines a repeatable visual language; the scene defines attention.** Avoid hardcoded viral colors, global neon/glass/shadows or treating high contrast as equivalent to taste.

- **Identity roles:** canvas/surface, primary/secondary text, signature accent, type hierarchy, logo and material texture.
- **Information roles:** input/output, cost/savings, danger/safe, comparison A/B, chart series. Keep meanings consistent *within* a video. Do not rely on color alone; shapes/labels reinforce encoding.
- **Attention roles:** one dominant highlight/callout/reveal; budget competing accents carefully.
- **Contrast:** accessible body text and large text; evaluate both actual frame backgrounds and feed-scale thumbnail. WCAG thresholds are a useful minimum, **not an aesthetic scoring algorithm**. [WCAG 2.2 contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- **Font system:** licensed display, body, numeric, caption and CJK fallbacks; visual tests for Japanese/English, symbols, prices, thin lines and kerning. Prefer a coherent type system over many decorative fonts.
- **Brand/mood separation:** calm/exciting/scary changes shot density, accent emphasis, music and SFX intensity **within approved bounds**; it should not arbitrarily change narrator identity, typography or emblem.
- **Cultural art direction:** traditional Japanese, contemporary East Asian, archival or ancient motifs must have specific materials/periods/typographic references and rights; avoid a generic grab bag of stereotyped symbols.

**Palette generation workflow:** select aesthetic direction + audience → generate restrained candidate semantic palettes → run contrast and color-role collision checks → preview hook/diagram/cost chart/thumbnail at actual output size → approve immutable BrandKit revision. Allow human refinement. Preserve existing approved releases when the kit changes.

## 8. Agent pipeline and ownership boundaries

**ContentGen (creative control):** topic evidence, opportunity, BrandKit revision, pattern selection, title/thumbnail/opening hypotheses, story beats, audio provider orchestration, music/SFX licensing, platform packaging, analytics feedback.

**Kumiki (visual execution):** composable SVG/media stills, infographic sections, domain assets, MG1/MD1 motion, VT1 transformations, CC1 camera, protected-text/critical-object validators, VideoExportStage + local FFmpeg adapter. **Never assume proposed Kumiki Composition schemas are implemented.** See `docs/14-kumiki-integration.md`.

**Audio:** narration and alignment define sample-accurate event times, scene anchors link to the one Kumiki frame clock; music/SFX duck and mix in ContentGen before final mux. Changing TTS provider should not alter the narrative schema, but may require timing and voice-match reapproval. See `docs/13-audio-production.md`.

### Minimal typed content contract (illustrative, not installed APIs)

```ts
interface CreativePattern {
  id: string;
  version: number;
  curiosityMechanism: string;       // magnitude | mechanism | comparison | contradiction...
  storyEngine: string;              // cost-revelation | engineering-experiment...
  compatibleHookIds: string[];
  thumbnailConceptIds: string[];
  visualIntentIds: string[];        // compile using supported Kumiki registry primitives
  requiredEvidenceRoles: string[];
  requiredPayoffRole: string;
  applicableFormats: string[];      // actual long/short behavior in delivery profiles
}
interface PackagingHypothesis {
  id: string;
  creativePatternId: string;
  title: string;
  thumbnailConceptId: string;
  openingPromise: string;
  answerPayoffEventId: string;
  claimEvidenceIds: string[];
  brandKitRevision: number;
  destinationProfileId: string;
}
interface StoryBeat {
  id: string;
  purpose: string;
  beforeState: string;
  operation: string;
  afterState: string;
  semanticObjectIds: string[];
  eventIds: string[];
  narrationCueId: string;
  evidenceIds: string[];
}
```

**Resolver:** `audience concern + verified claim → candidate curiosity mechanisms → choose narrative engine by evidence type → generate 3 distinct packaging hypotheses → preflight hook and payoff → build semantic StoryBeat sequence → compile into supported Kumiki components → render brand/platform variants`. Reject unknown schemas and missing renderer capabilities, not silent placeholders.

## 9. Deterministic gates, human QA and feedback

| Stage | Machine-checkable gate | Human/editorial judgment |
|---|---|---|
| Topic | Source timestamp, citation and claim/assumption trace | Audience relevance, original point of view |
| Package | At least 3 distinct *concept IDs*, title/payoff consistency, rights and preview legibility | Clear emotional relevance, non-generic thumbnail |
| Story | Required payoff exists, essential questions close, before/operation/after or justified hold, coherent ordering | Discovery feels earned, correct pace |
| Frame | Measured typography/bounds, charts/units, protected subjects, camera tracking, safe areas | Actual composition, realistic materials, premium restraint |
| Audio | Real alignment where available, no missing beats, clipping and rights checks, duration sync | Natural delivery, music balance, timing of silence |
| Release | Pinned brand/fonts/assets/renderer/mix/profile, destination-aware format and original provenance | Truthful conclusions, distinctiveness and approval |
| Experiment | Metric definitions, denominator, dates, observed variant IDs; unknown remains unknown | Why results may differ; next genuine creative hypothesis |

**YouTube experiments:** use official eligible title/thumbnail A/B experiments and the platform's reported **watch-time-share** outcome. Do not invent private CTR, retention or RPM from public views. Native test eligibility differs for Shorts. [Official documentation](https://support.google.com/youtube/answer/16391400).

**Avoid false automation confidence:** a diagram that passes overlap checks may still be boring; a hook that mentions the title may still fail to engage; a score cannot reliably predict virality. Preview selected frames and **one full film** before publishing a new format/brand recipe. Do not run LLM screenshot reviews or hundreds of AI calls in routine CI.

## 10. Complete worked example: three concepts, one HVAC topic

**Source topic:** Why replacing a home's HVAC system is expensive. **Evidence required:** example quote scoped to region/equipment, equipment specifications, labor hours, permits, ductwork/electrical changes, contractor overhead/warranty, climate and operating costs. Treat illustrative dollar amounts as scenarios, never universal averages.

| | Concept A: investigative cost | Concept B: engineering mystery | Concept C: consumer decision |
|---|---|---|---|
| Title | Why Replacing an HVAC System Costs So Much | What's Actually Inside an HVAC Replacement Quote? | Repair vs. Replace: When Does It Make Sense? |
| Thumbnail | House + quote + unresolved number | Exploded system + labor/material layers | Existing system versus new system |
| Opening | A real sample quote; where does each dollar go? | Show what a replacement actually changes | Present both initial costs and reliability/energy assumptions |
| Engine | `cost-revelation` | `engineering-experiment` / `inspect-interior` | `decision-showdown` |
| Visual sequence | Line items → labor/materials → waterfall → caveats | Components → mechanical operations → installation constraints | Two cash-flow paths → failures/repairs → crossovers |
| Answer | Transparent cost drivers | Specific technical work and risks | Conditions favoring repair or replacement |

The three outputs are different **stories**, not three versions of one title card. Each needs independently truthful research, hook, narration and terminal payoff.

## 11. Grounded case studies, 2026

The examples below are useful because their **story structure can be described from published creator transcripts**. Performance/thumbnail causality cannot be inferred from that description.

- **Practical Engineering, *Why Roads Get Washboards* (2026-06-02):** familiar annoyance → road/physics question → custom physical experiment → speed/force/material mechanisms → explanation. Excellent `mystery-investigation` + `prediction-observation` + `graph-plus-machine` candidate. [Creator transcript](https://practical.engineering/blog/2026/6/2/why-roads-get-washboards).
- **Practical Engineering, *Stopping the Unstoppable* (2026-09-01):** real incidents → constraint of safely stopping trains → alternative buffer designs and behavior → engineering tradeoffs. Useful `failure-investigation` and `constraint-test-solution` model. [Creator site](https://practical.engineering/blog/).
- **How Money Works, *WTF Is Happening To The Car Market?* (2026-06-12):** recognisable current troubles → apparent contradiction → market/mechanism investigation → consumer implications. Useful `economic-contradiction` and `stakes-first` hypothesis; research all claims independently. [Channel](https://www.youtube.com/@HowMoneyWorks).
- **Modern MBA, *Why Buffets Suddenly Disappeared* (2026-09-20):** memorable former success → decline of a business format → investigate constraints and turning points. Useful `rise-and-fall` storyboard reference. [Channel](https://www.youtube.com/@ModernMBA).

**Notable related evidence and reading:**

1. [vidIQ, *What 500 Breakout Thumbnails Reveal* (2026-07-08)](https://vidiq.com/vi/research/youtube-thumbnail-study/): observed face/text/contrast distributions, including study limitations.
2. [YouTube Creator Help: title/thumbnail experiments](https://support.google.com/youtube/answer/16391400): platform-native A/B test eligibility and watch-time-share interpretation.
3. [YouTube Creator Help: audience retention](https://support.google.com/youtube/answer/9314415): intro retention, spikes, dips and title/thumbnail promise alignment.
4. [Practical Engineering creator transcript (June 2026)](https://practical.engineering/blog/2026/6/2/why-roads-get-washboards): concrete opening and experiment sequence.
5. [WCAG 2.2 understanding contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): minimum legibility checks, not design/CTR prediction.
6. [YouTube monetization policy](https://support.google.com/youtube/answer/1311392): originality and repetitive/inauthentic content limitations.
7. [ContentGen dated market scan](research/2026-10-21-video-market-scan.md): specific 2026 channel samples, comparable outliers and audience demand; **refresh** before live opportunity ranking.

## 12. Agent task definition

When asked to create a video, coding agents should return an **editable, reviewable plan before render**:

1. `OpportunityBrief`: audience, problem, proof, originality angle and source timestamps.
2. Three *different* `PackagingHypothesis` objects, each linking title, thumbnail concept, first visual and payoff to the same evidence.
3. One selected `StoryEngine` and suitable hook; planned long vs short adaptations.
4. `StoryBeats`: semantic objects, input/transformation/output, narration and sound cues, evidence IDs, final takeaway.
5. BrandKit + delivery-profile binding and existing Kumiki registry capabilities; highlight missing assets instead of pretending implemented APIs exist.
6. Preflight report with deterministic failures, human preview points, licensing, expected cost/effort and unresolved assumptions.

**Ship a small proof first:** one convincing opening, one important mechanism animation and one truthful final answer, with tested portrait and landscape variants. Then scale by adding **meaningful** patterns supported by actual audience outcomes, never by mechanically reproducing last week's popular video.