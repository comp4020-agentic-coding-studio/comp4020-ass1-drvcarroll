import {
  DEMO_BITS,
  NO_DEFENCES,
  REAL_BITS,
  SCALE,
  forge,
  realSpace,
  space,
  type AttackerConfig,
  type Defences,
  type Threat,
} from "../dns/attack.js";
import { entries, type Cache } from "../dns/cache.js";
import { buildZones } from "../dns/live.js";
import { isWithin } from "../dns/names.js";
import { resolve } from "../dns/resolve.js";
import type {
  DNSRecord,
  NodeId,
  RecordType,
  ResolutionResult,
  ResolutionStep,
  Zone,
} from "../dns/types.js";
import { playResolution, type Playback } from "../graph/animate.js";
import { createGraph } from "../graph/render.js";
import { LEVEL1 } from "../levels/level1.js";
import { LEVEL2 } from "../levels/level2.js";
import { LEVEL3 } from "../levels/level3.js";
import {
  ATTACKER_IP,
  ATTACKER_NS,
  LEVEL4,
  STOLEN_ZONE,
  kaminskyName,
} from "../levels/level4.js";
import type { LevelConfig } from "../levels/types.js";
import { cacheTable, glossFor, recordTable, type Seen } from "./records.js";

const LEVELS: LevelConfig[] = [LEVEL1, LEVEL2, LEVEL3, LEVEL4];

// Long enough that short TTLs visibly die and long ones visibly do not.
const WAIT_STEP = 300;

const STEP_LABEL: Record<ResolutionStep["kind"], string> = {
  query: "Question",
  referral: "Referral",
  answer: "Answer",
  cname: "Alias",
  nodata: "No such record",
  nxdomain: "No such name",
  cached: "From cache",
  forged: "Forged — believed",
  rejected: "Forged — discarded",
};

const OUTCOME_NOTE: Record<ResolutionResult["outcome"], (q: string) => string> =
  {
    answered: (q) => `Resolved ${q}.`,
    // Said plainly, because "does not exist" here would simply be false.
    nodata: (q) => `${q} exists. It just has no record of that type.`,
    nxdomain: (q) => `${q} does not exist.`,
  };

// A message only counts as sent if it crossed an edge. A cached step has the
// resolver at both ends, which is precisely why it costs nothing.
const sent = (steps: ResolutionStep[]): number =>
  steps.filter((step) => step.from !== step.to).length;

// MX rdata is a priority and a hostname in one string. Only the tail is a
// name you could connect to; an address has no priority to strip.
const hostOf = (record: DNSRecord): string =>
  record.data.split(" ").at(-1) ?? record.data;

// The payoff: DNS is finished, so something can finally open a connection.
// Not a DNS message, which is why it is added here rather than in resolve().
// A type with no destination gets no step — NS and SOA are not somewhere to go.
function connectionStep(
  result: ResolutionResult,
  level: LevelConfig,
  client: NodeId,
): ResolutionStep[] {
  const to = level.destinations[result.question.type];
  const answer = result.answer[0];
  if (result.outcome !== "answered" || to === undefined || !answer) return [];
  return [
    {
      from: client,
      to,
      kind: "query",
      records: [],
      note: `Now the browser can connect to ${hostOf(answer)}`,
    },
  ];
}

function line(text: string, state?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  if (state !== undefined) p.dataset.state = state;
  return p;
}

const hex = (value: number): string =>
  `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

function stepRow(step: ResolutionStep, index: number, seen: Seen): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "step";
  row.dataset.kind = step.kind;

  const label = document.createElement("span");
  label.className = "step-label";
  label.textContent = `${String(index + 1)}. ${STEP_LABEL[step.kind]}`;

  const note = document.createElement("span");
  note.className = "step-note";
  note.textContent = step.note;

  row.append(label, note);

  // The acceptance test, shown as the number it actually is.
  if (step.txid !== undefined) {
    const id = document.createElement("span");
    id.className = "step-txid";
    id.textContent = hex(step.txid);
    row.append(id);
  }

  if (step.records.length > 0) {
    row.append(recordTable(step.records, step.kind, seen));
  }
  return row;
}

const SOURCE_NOTE: Record<string, string> = {
  loading: "Asking the real DNS…",
  live: "Real delegation data, fetched live over DNS-over-HTTPS. The names, addresses and TTLs below are genuine; the order of the walk is reconstructed, because a browser cannot watch a resolver work.",
  fallback:
    "The network did not answer, so this is a stored miniature internet. Only anu.edu.au and google.com exist in it.",
  simulated:
    "A stored miniature internet, deliberately. A browser cannot see inside a resolver's cache or make time pass, so this level simulates what the earlier ones fetched.",
  attack:
    "Simulated, and necessarily so: a page that really forged DNS replies would be committing the attack rather than explaining it. The mechanism is faithful; the transaction ID is deliberately smaller, and the panel says by how much.",
};

// A browser cannot observe referrals, so real zone data is fetched and the
// walk is rebuilt from it. When that fails the canned world stands in — the
// page must still teach with the network unplugged.
async function zonesFor(
  name: string,
  type: RecordType,
  level: LevelConfig,
  cache: Map<string, Zone[]>,
): Promise<{
  zones: Zone[];
  source: "live" | "fallback" | "simulated" | "attack";
}> {
  if (level.attack) return { zones: level.zones, source: "attack" };
  if (level.simulated) return { zones: level.zones, source: "simulated" };
  const key = `${name}|${type}`;
  const hit = cache.get(key);
  if (hit) return { zones: hit, source: "live" };
  try {
    const { zones } = await buildZones(name, type);
    cache.set(key, zones);
    return { zones, source: "live" };
  } catch {
    return { zones: level.zones, source: "fallback" };
  }
}

export function start(): void {
  const stage = document.querySelector<HTMLElement>("[data-graph]");
  const nav = document.querySelector<HTMLElement>("[data-levels]");
  const form = document.querySelector<HTMLFormElement>("[data-lookup]");
  const input = document.querySelector<HTMLInputElement>("[data-name]");
  const picker = document.querySelector<HTMLSelectElement>("[data-type]");
  const who = document.querySelector<HTMLSelectElement>("[data-client]");
  const typeNote = document.querySelector<HTMLElement>("[data-type-note]");
  const log = document.querySelector<HTMLElement>('[data-testid="output"]');
  const source = document.querySelector<HTMLElement>("[data-source]");
  const panel = document.querySelector<HTMLElement>("[data-cache]");
  const held = document.querySelector<HTMLElement>("[data-cache-table]");
  const clock = document.querySelector<HTMLElement>("[data-clock]");
  const wait = document.querySelector<HTMLButtonElement>("[data-wait]");
  const threats = document.querySelector<HTMLElement>("[data-threats]");
  const threat = document.querySelector<HTMLSelectElement>("[data-threat]");
  const fire = document.querySelector<HTMLButtonElement>("[data-forge]");
  const odds = document.querySelector<HTMLElement>("[data-odds]");
  if (!stage || !nav || !form || !input || !picker || !typeNote) return;
  if (!log || !source || !who || !panel || !held || !clock || !wait) return;
  if (!threats || !threat || !fire || !odds) return;

  let level = LEVELS[0] ?? LEVEL1;
  const graph = createGraph(stage, level);
  let playback: Playback | undefined;

  // The resolver's memory and its clock. Both belong to the page rather than
  // to a lookup: what a cache is for is outliving the query that filled it.
  let cache: Cache = new Map();
  let now = 0;

  // The attack is state too, and for the same reason: an attempt that lost is
  // only meaningful next to the attempts before it.
  let attempts = 0;
  const defences: Defences = { ...NO_DEFENCES };

  const draw = (): number => Math.floor(Math.random() * space(defences));

  const attacker = (): AttackerConfig => ({
    threat: threat.value as Threat,
    defences,
    zone: STOLEN_ZONE,
    ns: ATTACKER_NS,
    address: ATTACKER_IP,
    guess: draw,
  });

  // Any name in the stolen zone is worth racing — that is the point of forging
  // the delegation rather than an address. But only on a hop above the zone: a
  // delegation for anu.edu.au is only credible from the servers above it, and
  // once the resolver is already asking the attacker there is nothing to forge.
  const armed = (name: string, zone: Zone): boolean =>
    (name === STOLEN_ZONE || isWithin(name, STOLEN_ZONE)) &&
    zone.origin !== STOLEN_ZONE;

  // True once the resolver's memory names the attacker as the nameserver. No
  // separate flag: being poisoned is a fact about the cache, not about a page.
  const poisoned = (): boolean =>
    cache.get(`${STOLEN_ZONE}|NS`)?.records[0]?.data === ATTACKER_NS;

  const showThreat = (): void => {
    if (!level.attack) return;
    const one = space(defences);
    const real = realSpace(defences);
    const bits = defences.ports ? DEMO_BITS * 2 : DEMO_BITS;
    const realBits = defences.ports ? REAL_BITS * 2 : REAL_BITS;
    // On-path does not draw, so quoting odds at it would be a lie. The number
    // that matters there is zero guesses, and the price is network position.
    odds.replaceChildren(
      line(
        threat.value === "onpath"
          ? "No guessing: the query is readable, so the ID is known. " +
              "Entropy is not the defence against someone on the wire."
          : `1 in ${String(one)} per attempt — ${String(bits)} bits here, ` +
              `${String(realBits)} in real DNS, where it is 1 in ${real.toLocaleString()}.`,
      ),
      line(
        attempts === 0
          ? "No forged replies sent yet."
          : `${String(attempts)} attempts here ≈ ${(attempts * SCALE).toLocaleString()} against a real resolver.`,
      ),
      ...(poisoned()
        ? [line(`Poisoned. ${STOLEN_ZONE} now resolves through the attacker.`, "won")]
        : []),
    );
    fire.disabled = threat.value === "off";
  };

  const options = document.createElement("datalist");
  options.id = "known-names";
  input.setAttribute("list", options.id);
  input.after(options);

  // Fetched zone data, not the resolver's cache: this one only saves a
  // round trip to Google, and has nothing to do with what DNS caches.
  const zoneCache = new Map<string, Zone[]>();
  let token = 0;

  // The cache is only shown where it exists, so it never reads as an empty
  // feature on a level that has not introduced it.
  const showCache = (): void => {
    if (!level.caching) return;
    clock.textContent = `${String(Math.round(now / 60))} minutes in`;
    held.replaceChildren(cacheTable(entries(cache, now), now));
  };

  const run = async (
    name: string,
    type: RecordType,
    client: NodeId,
  ): Promise<void> => {
    playback?.cancel();
    log.replaceChildren();
    source.dataset.state = "loading";
    source.textContent = SOURCE_NOTE.loading ?? "";

    const mine = (token += 1);
    const { zones, source: origin } = await zonesFor(name, type, level, zoneCache);
    if (mine !== token) return; // a newer lookup already started

    source.dataset.state = origin;
    source.textContent = SOURCE_NOTE[origin] ?? "";

    // The same question against a resolver that remembers nothing. Comparing
    // the two is the only honest way to say what the cache saved.
    const cold = level.caching
      ? sent(resolve({ name, type }, zones, { now }).steps)
      : 0;

    // Only armed when a threat is selected, so level 4 with the attacker
    // switched off is level 3 with one more node drawn on it.
    const live = level.attack && threat.value !== "off";
    const result = resolve({ name, type }, zones, {
      cache: level.caching ? cache : undefined,
      now,
      client,
      txid: level.attack ? draw : undefined,
      intercept: live
        ? (q, asked, id) => {
            if (!armed(q.name, asked)) return undefined;
            attempts += 1;
            return forge(attacker(), q, id);
          }
        : undefined,
    });
    const steps = [...result.steps, ...connectionStep(result, level, client)];

    const list = document.createElement("ol");
    list.className = "steps";
    log.append(list);

    // One walk, one set: a term is explained where it first appears and the
    // later hops stay readable.
    const seen: Seen = new Set();

    playback = playResolution(graph, steps, {
      onStep(step, index) {
        list.append(stepRow(step, index, seen));
      },
      onDone() {
        const summary = document.createElement("p");
        summary.className = "summary";
        summary.dataset.outcome = result.outcome;
        summary.textContent =
          result.outcome === "answered"
            ? `Resolved in ${String(result.steps.length)} messages — and your machine sent only one of them.`
            : OUTCOME_NOTE[result.outcome](result.question.name);
        log.append(summary);

        if (level.caching) {
          const saved = cold - sent(result.steps);
          const count = document.createElement("p");
          count.className = "tally";
          count.textContent = `${String(sent(result.steps))} messages sent, ${String(saved)} saved by the cache.`;
          log.append(count);
          showCache();
        }
        showThreat();
      },
    });
  };

  const chosenType = (): RecordType =>
    (picker.value || level.types[0] || "A") as RecordType;

  const chosenClient = (): NodeId =>
    who.value || level.clients[0] || "stub";

  const submit = (): void => {
    void run(
      input.value.trim() || level.defaultQuery,
      chosenType(),
      chosenClient(),
    );
  };

  // Says what the selected type is before the walk runs, so the picker is a
  // choice the visitor understands rather than five acronyms.
  const describeType = (): void => {
    typeNote.hidden = picker.hidden;
    if (picker.hidden) return;
    const badge = document.createElement("code");
    badge.textContent = chosenType();
    typeNote.replaceChildren(badge, ` ${glossFor(chosenType())}`);
  };

  // A level reconfigures the one page: graph, picker, examples and prose.
  // Nothing is replaced wholesale, so what a level added stays visible.
  // An arrow, not a declaration: hoisting would discard the null narrowing
  // the querySelector guard above just established.
  const apply = (next: LevelConfig): void => {
    level = next;
    graph.setLevel(next);

    for (const button of nav.querySelectorAll("button")) {
      button.setAttribute(
        "aria-current",
        button.dataset.level === next.id ? "true" : "false",
      );
    }

    options.replaceChildren(
      ...next.knownNames.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        return option;
      }),
    );

    // One type means the question never varies, so the control would be a
    // decision the visitor is not being offered.
    picker.hidden = next.types.length < 2;
    picker.replaceChildren(
      ...next.types.map((type) => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        return option;
      }),
    );

    // One machine means there is nobody to share a cache with, so the
    // question of who is asking does not arise.
    who.hidden = next.clients.length < 2;
    who.replaceChildren(
      ...next.clients.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = next.nodes[id]?.title ?? id;
        return option;
      }),
    );

    // A new level is a fresh resolver: carrying a cache across would claim
    // this one had already learned something it never saw.
    cache = new Map();
    now = 0;
    panel.hidden = !next.caching;
    showCache();

    // A fresh resolver has never been lied to either, so the attempt count
    // and the defences reset with it.
    attempts = 0;
    threat.value = "off";
    defences.ports = false;
    defences.dnssec = false;
    for (const box of document.querySelectorAll<HTMLInputElement>(
      "[data-defence]",
    )) {
      box.checked = false;
    }
    threats.hidden = !next.attack;
    showThreat();

    for (const notes of document.querySelectorAll<HTMLElement>("[data-notes]")) {
      notes.hidden = notes.dataset.notes !== next.id;
    }

    describeType();
    input.value = next.defaultQuery;
    submit();
  };

  for (const config of LEVELS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = config.id;
    button.textContent = `${config.id.toUpperCase()} — ${config.title}`;
    button.addEventListener("click", () => {
      apply(config);
    });
    nav.append(button);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  picker.addEventListener("change", () => {
    describeType();
    submit();
  });
  who.addEventListener("change", submit);

  // Time passes and nothing else happens. The next lookup is the one that
  // finds out what survived, which is what a TTL actually governs.
  wait.addEventListener("click", () => {
    now += WAIT_STEP;
    showCache();
  });

  threat.addEventListener("change", () => {
    showThreat();
    submit();
  });

  for (const box of document.querySelectorAll<HTMLInputElement>(
    "[data-defence]",
  )) {
    box.addEventListener("change", () => {
      const which = box.dataset.defence;
      if (which === "ports") defences.ports = box.checked;
      if (which === "dnssec") defences.dnssec = box.checked;
      showThreat();
    });
  }

  // A name nobody has cached, so the attacker gets another go. Attacking the
  // real name gives you exactly one attempt before the true answer is cached
  // and every later question is answered from memory without a race at all.
  fire.addEventListener("click", () => {
    void run(kaminskyName(attempts), "A", chosenClient());
  });

  apply(level);
}
