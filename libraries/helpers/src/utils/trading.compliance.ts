// Flags wording a trading educator should not publish: promises of profit and
// results without risk wording. It only warns, the user decides. These rules are
// a reminder and not legal advice.

export interface ComplianceFlag {
  severity: 'high' | 'medium';
  phrase: string;
  reason: string;
}

const RULES: Array<{
  severity: ComplianceFlag['severity'];
  pattern: RegExp;
  reason: string;
}> = [
  {
    severity: 'high',
    pattern:
      /\b(guarantee[ds]?|guaranteeing)\b[^.!?\n]{0,40}\b(profits?|returns?|results?|income|gains?|wins?|money)\b/i,
    reason: 'Promises a financial outcome',
  },
  {
    severity: 'high',
    pattern:
      /\b(profits?|returns?|results?|income|gains?|wins?)\b[^.!?\n]{0,25}\bguaranteed\b/i,
    reason: 'Promises a financial outcome',
  },
  {
    severity: 'high',
    pattern:
      /\b(risk[- ]free|no[- ]risk|can'?t lose|cannot lose|never lose|zero risk|without (any )?risk)\b/i,
    reason: 'Trading always carries risk',
  },
  {
    severity: 'high',
    pattern:
      /\b(get rich|double your (money|account)|turn \W?\d[\d,.]*\w* into|financial freedom in|quit your job (in|after))\b/i,
    reason: 'Unrealistic earnings claim',
  },
  {
    severity: 'high',
    pattern: /\b(100%|\d{2,3}%)\s*(win rate|accuracy|accurate|success rate)\b/i,
    reason: 'A win rate claim needs evidence and context',
  },
  {
    severity: 'medium',
    pattern:
      /\b(you (will|'ll) (make|earn|profit)|easy money|passive income)\b/i,
    reason: 'Implies earnings the reader may not get',
  },
  {
    severity: 'medium',
    pattern:
      /\b(buy|sell|short|long)\s+[A-Z]{2,6}\b(?=[^.!?\n]{0,30}\b(now|today|before)\b)/,
    reason: 'Reads as a personal trade recommendation',
  },
];

const RESULTS =
  /\b\d+(\.\d+)?\s?%\s*(profit|return|gain|a (day|week|month|year))|\b(made|earned|profit(ed)?|banked)\s+(over\s+)?(\$|£|€)?\d/i;
const RISK_WORDING =
  /\b(risk|not financial advice|nfa|past performance|capital at risk|losses?|may lose)\b/i;

export const stripPostHtml = (text: string) =>
  (text || '')
    .replace(/<\/p>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

export const checkTradingCompliance = (value: string): ComplianceFlag[] => {
  const text = stripPostHtml(value);
  const flags: ComplianceFlag[] = [];
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      flags.push({
        severity: rule.severity,
        phrase: match[0].slice(0, 80),
        reason: rule.reason,
      });
    }
  }
  if (RESULTS.test(text) && !RISK_WORDING.test(text)) {
    flags.push({
      severity: 'medium',
      phrase: text.match(RESULTS)?.[0] || '',
      reason: 'Mentions results without any risk wording',
    });
  }
  return flags;
};
