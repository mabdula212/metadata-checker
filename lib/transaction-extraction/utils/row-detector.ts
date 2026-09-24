/**
 * Identifies transaction block boundaries and groups multi-line descriptions.
 */

export interface CandidateRawRow {
  pageNumber: number;
  dateStr: string;
  leadLine: string;
  continuationLines: string[];
  allText: string;
}

// Common statement header/footer tokens that should not trigger transaction rows
const EXCLUDED_LEAD_PATTERNS = [
  /^(?:tgl|tanggal|date|posting\s+date|trans\s*date|waktu)\b/i,
  /^(?:no\.?\s*rekening|account\s*no|rekening\s*koran|statement\s*of|laporan\s*mutasi)/i,
  /^(?:saldo\s*awal|saldo\s*akhir|opening\s*balance|closing\s*balance|beginning|ending)/i,
  /^(?:total\s*mutasi|total\s*kredit|total\s*debet|total\s*credit|total\s*debit)/i,
  /^(?:halaman|page|\f)/i,
];

// Matches a date at the start of a candidate transaction row
const LEADING_DATE_REGEX = /^(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/;

/**
 * Checks if a line begins with a valid transaction date.
 */
export function startsWithDate(line: string): { matches: boolean; dateStr?: string } {
  const trimmed = line.trim();
  if (!trimmed) return { matches: false };

  for (const ex of EXCLUDED_LEAD_PATTERNS) {
    if (ex.test(trimmed)) {
      return { matches: false };
    }
  }

  const match = trimmed.match(LEADING_DATE_REGEX);
  if (match) {
    return { matches: true, dateStr: match[1] };
  }

  return { matches: false };
}

/**
 * Groups lines on a page into candidate transaction blocks with multi-line support.
 */
export function detectCandidateRows(
  pageText: string,
  pageNumber: number
): CandidateRawRow[] {
  const lines = pageText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const candidates: CandidateRawRow[] = [];
  let currentCandidate: CandidateRawRow | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line is an explicit header/footer boundary that closes transaction rows
    const isBoundary =
      /^(?:saldo\s*awal|saldo\s*akhir|total\s*mutasi|mutasi\s*cr|mutasi\s*db|total\s*kredit|total\s*debet|halaman|page\s*\d+|bersambung\s*ke)/i.test(
        line
      );
    if (isBoundary) {
      if (currentCandidate) {
        currentCandidate.allText = [
          currentCandidate.leadLine,
          ...currentCandidate.continuationLines,
        ].join("\n");
        candidates.push(currentCandidate);
        currentCandidate = null;
      }
      continue;
    }

    const { matches, dateStr } = startsWithDate(line);

    if (matches && dateStr) {
      // If we already had a candidate in flight, save it
      if (currentCandidate) {
        currentCandidate.allText = [
          currentCandidate.leadLine,
          ...currentCandidate.continuationLines,
        ].join("\n");
        candidates.push(currentCandidate);
      }

      currentCandidate = {
        pageNumber,
        dateStr,
        leadLine: line,
        continuationLines: [],
        allText: line,
      };
    } else {
      // Continuation line for existing candidate (if any)
      if (currentCandidate) {
        // Exclude system page headers/footers in continuation
        if (
          !/^bca|bri|mandiri|bni|cimb|danamon|permata|mega|btn|ocbc|maybank|bsi/i.test(
            line
          ) &&
          !/^(?:kantor|cabang|telepon|call\s*center|hal\s*\d+|bersambung\s*ke)/i.test(line)
        ) {
          currentCandidate.continuationLines.push(line);
        }
      }
    }
  }

  if (currentCandidate) {
    currentCandidate.allText = [
      currentCandidate.leadLine,
      ...currentCandidate.continuationLines,
    ].join("\n");
    candidates.push(currentCandidate);
  }

  return candidates;
}
