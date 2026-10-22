import { CONCEPT_ELEMENTS, CONCEPT_IDS } from "./concepts";
import { refreshQa } from "./qa";
import type {
  ConceptId,
  Locale,
  ThumbnailBrandStyle,
  ThumbnailCopy,
  ThumbnailDocument,
  ThumbnailVariant,
} from "./types";
import { AUTHORING_SIZE, SAFE_INSET_RATIO, THUMBNAIL_KIND, THUMBNAIL_SCHEMA_VERSION } from "./types";

export const HVAC_EXAMPLE = {
  topic: "Why replacing an HVAC system costs so much",
  promise: "See where the money actually goes before you approve a replacement quote.",
} as const;

export const HVAC_EXAMPLE_JA = {
  topic: "空調の交換に、なぜそれだけ費用がかかるのか",
  promise: "見積もりを承認する前に、お金がどこへ消えるのかを理解する。",
} as const;

/**
 * Locale-keyed defaults, so the editor can follow the interface language while
 * the topic and promise are still untouched example copy.
 */
export const EXAMPLE_TOPIC: Record<Locale, string> = {
  en: HVAC_EXAMPLE.topic,
  ja: HVAC_EXAMPLE_JA.topic,
};

export const EXAMPLE_PROMISE: Record<Locale, string> = {
  en: HVAC_EXAMPLE.promise,
  ja: HVAC_EXAMPLE_JA.promise,
};

/** Local brand-style boundary. An approved BrandKit can replace these records later. */
export const THUMBNAIL_BRANDS: Record<string, ThumbnailBrandStyle> = {
  "house-math": {
    brandId: "house-math",
    brandName: "House Math",
    revision: 1,
    paletteId: "blueprint",
    typography: {
      display: { family: "Newsreader Variable", weight: 600 },
      numbers: { family: "Geist Variable", weight: 650 },
      body: { family: "Geist Variable", weight: 500 },
    },
  },
  "margin-atlas": {
    brandId: "margin-atlas",
    brandName: "Margin Atlas",
    revision: 1,
    paletteId: "ledger",
    typography: {
      display: { family: "Newsreader Variable", weight: 600 },
      numbers: { family: "Geist Variable", weight: 650 },
      body: { family: "Geist Variable", weight: 500 },
    },
  },
};

export const DEFAULT_BRAND_ID = "house-math";

export const VARIANT_ID_BY_CONCEPT: Record<ConceptId, string> = {
  "price-shock": "variant-price-shock",
  "hidden-cost": "variant-hidden-cost",
  "quote-gap": "variant-quote-gap",
};

const DEFAULT_COPY: Record<ConceptId, Record<Locale, ThumbnailCopy>> = {
  "price-shock": {
    en: {
      headline: "Same house. A new system. A new price.",
      value: "$12,400?",
      secondary: "A mid-range replacement, fully installed, in one number.",
    },
    ja: {
      headline: "同じ家、同じ広さ。変わるのは金額だけ。",
      value: "$12,400?",
      secondary: "標準的な機器への交換を、設置込みの総額で示す。",
    },
  },
  "hidden-cost": {
    en: {
      headline: "The quote is never one number.",
      value: "$12,400",
      secondary: "Equipment, labour, ductwork and permits are bundled into a single line.",
    },
    ja: {
      headline: "見積もりは、ひとつの数字ではない。",
      value: "$12,400",
      secondary: "機器・人件費・ダクト・許認可が、1行にまとめられている。",
    },
  },
  "quote-gap": {
    en: {
      headline: "The unit is not the installation.",
      value: "$12,400",
      compareValue: "$4,800",
      secondary: "The advertised price covers equipment. Installation is priced separately.",
    },
    ja: {
      headline: "本体価格は、設置費用ではない。",
      value: "$12,400",
      compareValue: "$4,800",
      secondary: "広告の価格は機器のみ。設置には別の費用がかかる。",
    },
  },
};

export function createDefaultVariants(): ThumbnailVariant[] {
  return CONCEPT_IDS.map((concept) => ({
    id: VARIANT_ID_BY_CONCEPT[concept],
    concept,
    copy: {
      en: { ...DEFAULT_COPY[concept].en },
      ja: { ...DEFAULT_COPY[concept].ja },
    },
    elements: CONCEPT_ELEMENTS[concept].map((element) => ({ ...element })),
  }));
}

export function defaultVariantCopy(concept: ConceptId, locale: Locale): ThumbnailCopy {
  return { ...DEFAULT_COPY[concept][locale] };
}

export interface CreateThumbnailDocumentOptions {
  projectId?: string;
  brandId?: string;
  topic?: string;
  promise?: string;
}

/** Deterministic fixture: the same inputs always produce the same document. */
export function createThumbnailDocument(
  options: CreateThumbnailDocumentOptions = {}
): ThumbnailDocument {
  const brand = THUMBNAIL_BRANDS[options.brandId ?? DEFAULT_BRAND_ID] ?? THUMBNAIL_BRANDS[DEFAULT_BRAND_ID];
  const variants = createDefaultVariants();
  const base: ThumbnailDocument = {
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    kind: THUMBNAIL_KIND,
    id: "thumbnail-hvac-replacement",
    projectId: options.projectId ?? "local-project",
    topic: options.topic ?? HVAC_EXAMPLE.topic,
    promise: options.promise ?? HVAC_EXAMPLE.promise,
    brand: {
      ...brand,
      typography: {
        display: { ...brand.typography.display },
        numbers: { ...brand.typography.numbers },
        body: { ...brand.typography.body },
      },
    },
    paletteId: brand.paletteId,
    output: {
      width: AUTHORING_SIZE.width,
      height: AUTHORING_SIZE.height,
      aspect: "16:9",
      safeInset: SAFE_INSET_RATIO,
    },
    activeVariantId: variants[0]?.id ?? VARIANT_ID_BY_CONCEPT["price-shock"],
    variants,
    provenance: {
      origin: "fixture",
      values: "synthetic-demo",
      note: "Fixture for the local thumbnail composer. All figures are invented for demonstration.",
      sources: [
        {
          id: "docs/16",
          label: "Creative pattern library",
          note: "Composition grammar: number reversal, exploded cutaway, a-vs-b.",
        },
        {
          id: "docs/15",
          label: "Video performance system",
          note: "Premium thumbnail design contract and small-format checks.",
        },
        {
          id: "synthetic-hvac",
          label: "Synthetic HVAC example",
          note: "No quote, average or measured claim is represented.",
        },
      ],
    },
    qa: { status: "pass", checkedRevision: 1, issues: [] },
    lastExport: null,
    revision: 1,
  };
  return refreshQa(base);
}
