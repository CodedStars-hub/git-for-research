const STOP_WORDS = new Set(
  "a about an and are as at be before believe current currently did do does earlier explain find for from how is it latest me of our previous previously repository research result results say says show tell that the their this to was were what when where which who why with".split(" "),
);
const FOLLOW_UP = /^(?:and\s+)?(?:what about before|what was it previously|what did we believe before that|why did that change|what evidence supports that|what about earlier|and before|why|what was it before)[?.!\s]*$/i;

export function meaningfulTerms(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((term) => !STOP_WORDS.has(term)))];
}

export function hasMeaningfulOverlap(content, queryTerms) {
  const contentTerms = new Set(meaningfulTerms(content));
  return queryTerms.some((term) => contentTerms.has(term));
}

function intentFor(question) {
  if (/\b(previous|previously|earlier|before)\b/i.test(question)) return "HISTORICAL";
  if (/\b(change|changed|evol|develop)\w*\b/i.test(question)) return "EVOLUTION";
  if (/\b(evidence|support|source|citation)\w*\b/i.test(question)) return "EVIDENCE";
  if (/\b(conflict|contradict|disagree)\w*\b/i.test(question)) return "CONFLICT";
  if (/\b(current|currently|latest|now|conclud|recommend|benchmark)\w*\b/i.test(question)) return "CURRENT_STATE";
  return "GENERAL_REPOSITORY_QUERY";
}

function previousTopic(history) {
  const previousUser = [...history].reverse().find((message) => message.role === "user" && meaningfulTerms(message.content).length);
  return previousUser ? meaningfulTerms(previousUser.content) : [];
}

export function analyzeAssistantQuery(question, history = []) {
  const normalized = question.trim();
  const isFollowUp = FOLLOW_UP.test(normalized);
  const explicitTerms = meaningfulTerms(normalized);
  const topicTerms = isFollowUp ? previousTopic(history) : explicitTerms;
  const intent = intentFor(normalized);
  const intentTerms = intent === "HISTORICAL" ? ["earlier", "previous"] : intent === "CURRENT_STATE" ? ["current", "latest"] : [];
  return { intent, isFollowUp, topicTerms, effectiveQuery: [...topicTerms, ...intentTerms].join(" ") };
}
