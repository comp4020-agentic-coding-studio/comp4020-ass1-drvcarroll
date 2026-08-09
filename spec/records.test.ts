import { describe, expect, it } from "vitest";
import { humanTtl, roleOf } from "../src/ui/records.js";
import type { DNSRecord } from "../src/dns/types.js";

const record = (type: DNSRecord["type"]): DNSRecord => ({
  name: "anu.edu.au.",
  type,
  ttl: 3600,
  data: "x",
});

describe("a record's role depends on the message carrying it", () => {
  // The same NS record means two different things. From a parent it is a
  // delegation; from the zone itself it is an authoritative answer.
  it("splits a referral into its delegation and its glue", () => {
    expect(roleOf("referral", record("NS"))).toBe("delegation");
    expect(roleOf("referral", record("A"))).toBe("glue");
  });

  it("calls the same NS record an answer when the zone owns it", () => {
    expect(roleOf("answer", record("NS"))).toBe("answer");
  });

  it("names the alias and the denial for what they are", () => {
    expect(roleOf("cname", record("CNAME"))).toBe("alias");
    expect(roleOf("nxdomain", record("SOA"))).toBe("denial");
  });
});

describe("a TTL is read in units people use", () => {
  it("scales to the largest unit that fits", () => {
    expect(humanTtl(30)).toBe("30 seconds");
    expect(humanTtl(300)).toBe("5 minutes");
    expect(humanTtl(3600)).toBe("1 hour");
    expect(humanTtl(172800)).toBe("2 days");
  });
});
