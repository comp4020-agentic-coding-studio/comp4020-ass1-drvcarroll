// The protocol's data model. Nothing here touches the DOM — see
// STRUCTURE.md, "Architecture": src/dns must stay testable headless.

export type NodeId = string;

export type RecordType = "A" | "AAAA" | "NS" | "CNAME" | "MX" | "SOA";

export interface DNSRecord {
  name: string;
  type: RecordType;
  ttl: number;
  data: string;
}

export interface Zone {
  origin: string; // "." for root, "au." for the TLD, and so on
  server: NodeId;
  records: DNSRecord[];
  // Which nameserver this is. Normally redundant — until two servers claim
  // the same zone, which is precisely what a poisoned delegation looks like.
  ns?: string;
}

export interface Question {
  name: string;
  type: RecordType;
}

// A referral is not an answer. Keeping them distinct here is what lets the
// graph render them differently — STRUCTURE.md concept 3.
// "cached" is the resolver answering itself: from and to are both the
// resolver, which is exactly the picture — the message never left.
// "nodata" is not "nxdomain": the name exists, it simply has no record of the
// type asked for. Conflating them tells the visitor a name is missing when it
// is not, which an explainer about trust cannot afford to do.
// "forged" and "rejected" are the same message with a different transaction
// ID. That is the entire difference, and it is why they are two kinds rather
// than one kind with a flag: the resolver's whole acceptance test is here.
// "timeout" is not "nxdomain" either: the name may well exist, but nobody is
// answering for it. Reporting a downed server as a missing name would hide
// the outage, which is exactly what the visitor is being invited to cause.
export type StepKind =
  | "query"
  | "referral"
  | "answer"
  | "cname"
  | "nodata"
  | "nxdomain"
  | "timeout"
  | "cached"
  | "forged"
  | "rejected";

// One directed message on one edge. The animation plays these in order.
// `zone` names which zone the far end is speaking for, so one graph node can
// stand in for every TLD without a node per zone.
export interface ResolutionStep {
  from: NodeId;
  to: NodeId;
  kind: StepKind;
  records: DNSRecord[];
  note: string;
  zone?: string;
  // The 16-bit number a reply has to quote to be believed. Carried on the
  // step so the acceptance test can be shown rather than described.
  txid?: number;
}

export interface ResolutionResult {
  question: Question;
  steps: ResolutionStep[];
  outcome: "answered" | "nodata" | "nxdomain" | "timeout";
  answer: DNSRecord[];
}

// What a nameserver can say. It cannot say "cached" — only a resolver can —
// and "forged" is not a kind of answer, it is who sent one.
export interface Response {
  kind: Exclude<
    StepKind,
    "query" | "cached" | "forged" | "rejected" | "timeout"
  >;
  records: DNSRecord[];
}
