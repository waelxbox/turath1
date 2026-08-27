export const suggestionFieldNames = [
  "title",
  "description",
  "workType",
  "agents",
  "dates",
  "locations",
  "subjects",
  "culturalContext",
  "materials",
  "techniques",
  "inscriptions",
  "stylePeriod",
] as const;

export type SuggestionField = (typeof suggestionFieldNames)[number];

const suggestionFieldSet = new Set<string>(suggestionFieldNames);

export function reviewedSuggestionFields(
  provenance: unknown,
  key: "acceptedFields" | "rejectedFields",
): SuggestionField[] {
  if (!provenance || typeof provenance !== "object") return [];
  const value = (provenance as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(
    (field): field is SuggestionField => typeof field === "string" && suggestionFieldSet.has(field),
  )));
}

export function acceptSuggestedFields(input: {
  title: string;
  reviewedJson: unknown;
  suggestions: unknown;
  provenance: unknown;
  acceptedFields: SuggestionField[];
  userId: number;
  reviewedAt: string;
}) {
  const suggestions = input.suggestions && typeof input.suggestions === "object"
    ? input.suggestions as Record<string, unknown>
    : {};
  const reviewedJson = input.reviewedJson && typeof input.reviewedJson === "object" && !Array.isArray(input.reviewedJson)
    ? { ...input.reviewedJson as Record<string, unknown> }
    : {};
  const provenance = input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance)
    ? input.provenance as Record<string, unknown>
    : {};
  const previouslyAccepted = reviewedSuggestionFields(provenance, "acceptedFields");
  const previouslyRejected = reviewedSuggestionFields(provenance, "rejectedFields");
  const requested = Array.from(new Set(input.acceptedFields));
  const appliedFields = requested.filter(field => {
    if (previouslyAccepted.includes(field)) return false;
    if (field === "title") return typeof suggestions.title === "string" && suggestions.title.trim().length > 0;
    return Object.prototype.hasOwnProperty.call(suggestions, field);
  });

  let title = input.title;
  for (const field of appliedFields) {
    if (field === "title") title = (suggestions.title as string).trim();
    else reviewedJson[field] = suggestions[field];
  }

  return {
    title,
    reviewedJson,
    appliedFields,
    suggestionProvenance: {
      ...provenance,
      acceptedFields: Array.from(new Set([...previouslyAccepted, ...appliedFields])),
      rejectedFields: previouslyRejected.filter(field => !appliedFields.includes(field)),
      lastReviewedAt: input.reviewedAt,
      lastReviewedByUserId: input.userId,
    },
  };
}

export function rejectSuggestedFields(input: {
  provenance: unknown;
  rejectedFields: SuggestionField[];
  userId: number;
  reviewedAt: string;
}) {
  const provenance = input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance)
    ? input.provenance as Record<string, unknown>
    : {};
  const previouslyAccepted = reviewedSuggestionFields(provenance, "acceptedFields");
  const previouslyRejected = reviewedSuggestionFields(provenance, "rejectedFields");
  const appliedFields = Array.from(new Set(input.rejectedFields)).filter(field => !previouslyRejected.includes(field));

  return {
    appliedFields,
    suggestionProvenance: {
      ...provenance,
      acceptedFields: previouslyAccepted.filter(field => !appliedFields.includes(field)),
      rejectedFields: Array.from(new Set([...previouslyRejected, ...appliedFields])),
      lastReviewedAt: input.reviewedAt,
      lastReviewedByUserId: input.userId,
    },
  };
}
