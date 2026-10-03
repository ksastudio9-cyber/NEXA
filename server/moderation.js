import { domainToASCII } from 'node:url';

const defaultBlockedTerms = ['كسم', 'زب', 'قحبة', 'fuck', 'shit'];

function normalizeModerationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/([^\p{L}\p{N}\s])(?=[\p{L}\p{N}])/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1$1')
    .trim();
}

export function contentCheck(value) {
  const text = ` ${normalizeModerationText(value)} `;
  const configuredTerms = (process.env.CONTENT_BLOCKLIST || '').split(',');
  const blockedTerms = [...new Set([...defaultBlockedTerms, ...configuredTerms])]
    .map(normalizeModerationText)
    .filter(Boolean);

  return blockedTerms.some(term => text.includes(` ${term} `)) ? 'CONTENT_REJECTED' : null;
}

export function normalizeAllowedHost(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate || candidate.length > 253 || /[\s/@?#]/u.test(candidate)) return null;
  const hostname = candidate.replace(/\.$/u, '');
  const asciiHost = domainToASCII(hostname);
  if (!asciiHost || asciiHost.length > 253 || !asciiHost.includes('.')) return null;
  const labels = asciiHost.split('.');
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) return null;
  return asciiHost;
}

function normalizeLinkText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/hxxps?/gu, match => match === 'hxxps' ? 'https' : 'http')
    .replace(/[([{]\s*\.\s*[)\]}]/gu, '.')
    .replace(/\s+dot\s+/gu, '.')
    .replace(/\s+\.\s+(?=(?:com|org|net|edu|gov|mil|int|io|ai|app|dev|co|me|tv|ly|xyz|info|biz|online|site)\b)/gu, '.')
    .replace(/\s*:\s*/gu, ':')
    .replace(/\s*\/\s*/gu, '/');
}

export function linkCheck(value, allowedHosts = []) {
  const text = normalizeLinkText(value);
  const allowed = new Set(allowedHosts.map(normalizeAllowedHost).filter(Boolean));
  const candidates = text.match(/(?<![@\p{L}\p{N}_-])(?:https?:\/\/)?(?:(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?:[/?#][^\s<>()]*)?/giu) || [];
  const hasHttpScheme = /https?:\/\//iu.test(text);
  const hasDisallowedScheme = /\b(?:javascript|data|file|ftp|mailto):/iu.test(text);
  if (hasDisallowedScheme || (hasHttpScheme && !candidates.length)) return 'LINK_NOT_ALLOWED';

  for (const candidate of candidates) {
    let hostname;
    try {
      hostname = new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname;
    } catch {
      return 'LINK_NOT_ALLOWED';
    }
    const normalizedHost = normalizeAllowedHost(hostname);
    const isAllowed = normalizedHost && [...allowed].some(host => normalizedHost === host || normalizedHost.endsWith(`.${host}`));
    if (!isAllowed) return 'LINK_NOT_ALLOWED';
  }

  return null;
}
