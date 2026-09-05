export function validateEvidenceLinkedAnswer(content: unknown, availableRecordIndices: number[]) {
  const answer = typeof content === "string" ? content.trim() : "";
  const available = new Set(availableRecordIndices);
  const citedIndices = Array.from(answer.matchAll(/\[Record\s+(\d+)\]/gi))
    .map(match => Number(match[1]));
  const uniqueCitations = Array.from(new Set(citedIndices));
  const paragraphs = answer.split(/\n\s*\n/).filter(paragraph => paragraph.trim());
  const citationsAreValid = uniqueCitations.length > 0 && uniqueCitations.every(index => available.has(index))
    && paragraphs.every(paragraph => /\[Record\s+\d+\]/i.test(paragraph));
  if (!answer || !citationsAreValid) {
    return {
      answer: "I found potentially relevant approved records, but could not produce a reliably cited answer. Open the linked evidence and refine the question before drawing a conclusion.",
      citedIndices: availableRecordIndices,
      insufficientEvidence: true,
    };
  }
  return { answer, citedIndices: uniqueCitations, insufficientEvidence: false };
}
