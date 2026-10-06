/**
 * The seeded policy: written sections (added to the existing Office FAQ corpus,
 * page 19) and the rules that cite them. Demo text for this prototype — a
 * college replaces both with its own handbook; every rule change is versioned,
 * approved by an administrator and audited.
 */

export const POLICY_SOURCE = "Demo policy corpus written for this prototype — replace with the college's own rules";

// [key, category, section, title, body, keywords]
export const RULE_SECTIONS = [
  [
    "CERT-BONAFIDE-INSTANT",
    "CERTIFICATE",
    "§4.2",
    "Instant bonafide certificate",
    "A bonafide certificate is issued immediately, without review, to an enrolled student who has no overdue dues above 1,000 rupees on the fee ledger and has requested fewer than 5 bonafide certificates in the last 30 days. Any other request is reviewed by the academic office within 24 hours.",
    ["bonafide", "instant", "certificate", "immediately", "automatic", "dues"]
  ],
  [
    "CERT-VISA-CHECK",
    "CERTIFICATE",
    "§4.3",
    "Certificates for visa or passport use",
    "A bonafide certificate requested for a visa, passport or embassy is always checked by the academic office before it is issued, because the embassy may call the office to confirm it.",
    ["visa", "passport", "embassy", "abroad", "bonafide"]
  ],
  [
    "LEAVE-DAY-OUTING-AUTO",
    "LEAVE",
    "§7.3",
    "Day outing approved on guardian confirmation",
    "A day outing is approved as soon as the guardian confirms it by SMS code when it is applied for at least 2 hours before leaving, lasts at most 8 hours, returns by 21:00, and the student has had no late or overdue return in the last 30 days. Every other outing is decided by the warden. The guardian code is never skipped.",
    ["outing", "gate", "pass", "automatic", "approved", "guardian", "warden"]
  ],
  [
    "LEAVE-SHORT-SAMEDAY-AUTO",
    "LEAVE",
    "§7.4",
    "Short same-day outing approved on guardian confirmation",
    "A short outing that leaves and returns on the same day and lasts between 1 and 3 hours is approved as soon as the guardian confirms it by SMS code, however soon the student leaves, when the student has had no late or overdue return in the last 30 days. The QR is issued at once. The guardian code is never skipped.",
    ["outing", "short", "same day", "gate", "pass", "automatic", "approved", "guardian", "qr"]
  ],
  [
    "FEES-RECEIPT-COPY",
    "FEES",
    "§9.4",
    "Copy of a fee receipt",
    "A copy of a fee receipt that is on the student's fee ledger is issued immediately, up to 3 copies in 30 days. A receipt that is not on the ledger is checked by the accounts office.",
    ["receipt", "copy", "duplicate", "fee", "payment", "proof"]
  ]
];

// Existing Office FAQ sections (page 19) on the same topic as each rule section.
const RELATED = {
  "CERT-BONAFIDE-INSTANT": ["CERT-BONAFIDE"],
  "CERT-VISA-CHECK": ["CERT-BONAFIDE"],
  "LEAVE-DAY-OUTING-AUTO": ["LEAVE-GATE-PASS", "HOSTEL-IN-TIME", "LEAVE-LATE-RETURN"],
  "LEAVE-SHORT-SAMEDAY-AUTO": ["LEAVE-GATE-PASS", "LEAVE-LATE-RETURN"],
  "FEES-RECEIPT-COPY": ["FEES-DEADLINES"]
};

const cite = (key) => {
  const row = RULE_SECTIONS.find((s) => s[0] === key);
  return { section: row[2], key, text: row[4], related: RELATED[key] || [] };
};

export const DEFAULT_RULES = [
  {
    key: "BONAFIDE-INSTANT",
    requestType: "BONAFIDE_CERTIFICATE",
    title: "Instant bonafide certificate",
    action: "AUTO_APPROVE",
    citation: cite("CERT-BONAFIDE-INSTANT"),
    conditions: [
      { field: "enrolled", op: "isTrue", value: true, label: "Enrolled student with a student ID", failText: "No enrolled student record was found for this account." },
      { field: "overdueDues", op: "lte", value: 1000, label: "No overdue dues above ₹1,000 (fee ledger, page 16)", failText: "₹{actual} is overdue on your fee ledger (the limit is ₹1,000). Clearing it on page 16 makes the next request instant." },
      { field: "requestsLast30Days", op: "lt", value: 5, label: "Fewer than 5 bonafide requests in the last 30 days", failText: "{actual} bonafide certificates were already requested in the last 30 days (limit 5)." }
    ]
  },
  {
    key: "BONAFIDE-VISA-CHECK",
    requestType: "BONAFIDE_CERTIFICATE",
    title: "Visa or passport use is checked by the office",
    action: "ROUTE_TO_HUMAN",
    citation: cite("CERT-VISA-CHECK"),
    conditions: [{ field: "purposeVisa", op: "isTrue", value: true, label: "Purpose mentions a visa, passport or embassy" }]
  },
  {
    key: "GATEPASS-DAY-OUTING",
    requestType: "GATE_PASS",
    title: "Day outing approved on guardian confirmation",
    action: "AUTO_APPROVE",
    citation: cite("LEAVE-DAY-OUTING-AUTO"),
    conditions: [
      { field: "guardianOtpVerified", op: "isTrue", value: true, label: "Guardian confirmed by one-time code", failText: "The guardian has not confirmed the outing yet." },
      { field: "leadTimeHours", op: "gte", value: 2, label: "Applied at least 2 hours before leaving", failText: "Applied {actual} hours before leaving — short-notice outings are decided by the warden." },
      { field: "durationHours", op: "lte", value: 8, label: "Out for at most 8 hours", failText: "The outing is {actual} hours long (the limit for automatic approval is 8)." },
      { field: "returnBeforeCutoff", op: "isTrue", value: true, label: "Back by 21:00 the same day", failText: "The return time is after 21:00 or on another day." },
      { field: "lateReturnsLast30Days", op: "eq", value: 0, label: "No late or overdue return in the last 30 days", failText: "{actual} late or overdue return(s) in the last 30 days — the warden decides." }
    ]
  },
  {
    // A short outing needs no advance notice: a same-day trip of 1–3 hours is approved on the guardian's code.
    key: "GATEPASS-SHORT-SAMEDAY",
    requestType: "GATE_PASS",
    title: "Short same-day outing (1–3 hours) approved on guardian confirmation",
    action: "AUTO_APPROVE",
    citation: cite("LEAVE-SHORT-SAMEDAY-AUTO"),
    conditions: [
      { field: "guardianOtpVerified", op: "isTrue", value: true, label: "Guardian confirmed by one-time code", failText: "The guardian has not confirmed the outing yet." },
      { field: "sameDay", op: "isTrue", value: true, label: "Leaves and returns on the same day", failText: "The return is on a different day from the departure." },
      { field: "durationHours", op: "gte", value: 1, label: "Out for at least 1 hour", failText: "The outing is {actual} hours long (short outings are 1–3 hours)." },
      { field: "durationHours", op: "lte", value: 3, label: "Out for at most 3 hours", failText: "The outing is {actual} hours long (short outings are 1–3 hours)." },
      { field: "lateReturnsLast30Days", op: "eq", value: 0, label: "No late or overdue return in the last 30 days", failText: "{actual} late or overdue return(s) in the last 30 days — the warden decides." }
    ]
  },
  {
    key: "FEE-RECEIPT-COPY",
    requestType: "FEE_RECEIPT_COPY",
    title: "Copy of a fee receipt on the ledger",
    action: "AUTO_APPROVE",
    citation: cite("FEES-RECEIPT-COPY"),
    conditions: [
      { field: "receiptOnLedger", op: "isTrue", value: true, label: "The receipt number is on your fee ledger", failText: "That receipt number is not on your fee ledger — the accounts office will check it." },
      { field: "copiesLast30Days", op: "lt", value: 3, label: "Fewer than 3 receipt copies in the last 30 days", failText: "{actual} receipt copies were already issued in the last 30 days (limit 3)." }
    ]
  }
];
