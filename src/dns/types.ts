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
}

export interface Question {
  name: string;
  type: RecordType;
}

// A referral is not an answer. Keeping them distinct here is what lets the
// graph render them differently — STRUCTURE.md concept 3.
export type StepKind = "query" | "referral" | "answer" | "cname" | "nxdomain";

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
}

export interface ResolutionResult {
  question: Question;
  steps: ResolutionStep[];
  outcome: "answered" | "nxdomain";
  answer: DNSRecord[];
}

export interface Response {
  kind: Exclude<StepKind, "query">;
  records: DNSRecord[];
}
