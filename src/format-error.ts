import type { LLMFormattedError } from './types.js';
import { classifyError } from './classify.js';

const SANITIZE_PATTERNS: Array<[RegExp, string]> = [
  // Stack traces
  [/\n\s+at\s+.+/g, ''],
  // Localhost URLs
  [/https?:\/\/localhost[^\s]*/gi, '[localhost]'],
  [/https?:\/\/127\.0\.0\.1[^\s]*/gi, '[localhost]'],
  // Passwords in URLs
  [/(:\/\/[^:@\s]+:)[^@\s]+(@)/g, '$1[redacted]$2'],
  // Authorization headers / bearer tokens
  [/bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'bearer [redacted]'],
  // API key-like patterns (long alphanumeric strings)
  [/\b(sk|pk|api|key|token|secret)[-_][A-Za-z0-9\-_]{8,}/gi, '[redacted]'],
];

function sanitizeMessage(message: string): string {
  let s = message;
  for (const [pattern, replacement] of SANITIZE_PATTERNS) {
    s = s.replace(pattern, replacement);
  }
  return s.trim();
}

export function formatErrorForLLM(
  error: unknown,
  options?: { toolName?: string; attemptsMade?: number }
): LLMFormattedError {
  const classification = classifyError(error);

  let code: string;
  let message: string;
  let retriable: boolean;
  let suggestion: string;

  switch (classification.category) {
    case 'rate-limited':
      code = 'RATE_LIMITED';
      message = 'Rate limit exceeded';
      retriable = true;
      suggestion = 'Wait before retrying or reduce request frequency';
      break;
    case 'retriable':
      code = 'SERVICE_UNAVAILABLE';
      message = 'Service temporarily unavailable';
      retriable = true;
      suggestion = 'Retry the operation';
      break;
    case 'timeout':
      code = 'TIMEOUT';
      message = 'Request timed out';
      retriable = true;
      suggestion = 'Try again or reduce payload size';
      break;
    case 'non-retriable': {
      code = 'INVALID_REQUEST';
      const rawMessage = classification.message || (error instanceof Error ? error.message : String(error));
      message = sanitizeMessage(rawMessage);
      retriable = false;
      suggestion = 'Check the tool arguments';
      break;
    }
    case 'unknown':
    default:
      code = 'UNKNOWN_ERROR';
      message = 'An unexpected error occurred';
      retriable = true;
      suggestion = 'Retry once; if it persists, report the issue';
      break;
  }

  const result: LLMFormattedError = { error: true, code, message, retriable, suggestion };
  if (options?.toolName) result.tool = options.toolName;
  if (options?.attemptsMade !== undefined) result.attemptsMade = options.attemptsMade;
  return result;
}
