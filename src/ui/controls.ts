// Knob widgets. Every one of them is rendered into the inspector of the thing
// it changes, so there is no control panel: the page's only persistent controls
// are the transport and the speed slider.
//
// Both widgets take their current value and a callback, and hold no state of
// their own. The config is the state; a widget that remembered its own would be
// a second copy of the truth, free to disagree with the simulation.

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
};

function frame(legend: string, note?: string): HTMLFieldSetElement {
  const set = el("fieldset", "knob");
  const caption = el("legend");
  caption.textContent = legend;
  set.append(caption);
  if (note !== undefined) {
    const hint = el("p", "knob-note");
    hint.textContent = note;
    set.append(hint);
  }
  return set;
}

export interface Ladder {
  legend: string;
  note?: string;
  // The rungs, ascending. A ladder rather than a range: TTL runs from one
  // second to a day, and a linear slider over that spends all its travel in
  // values nobody wants.
  values: readonly number[];
  at: number;
  format: (value: number) => string;
  onPick: (value: number) => void;
}

const nearest = (values: readonly number[], at: number): number => {
  let best = 0;
  for (const [index, value] of values.entries()) {
    const closer = Math.abs(value - at) < Math.abs((values[best] ?? 0) - at);
    if (closer) best = index;
  }
  return best;
};

export function stepper(spec: Ladder): HTMLElement {
  const set = frame(spec.legend, spec.note);
  const row = el("div", "knob-row");
  const index = nearest(spec.values, spec.at);

  const move = (by: number): HTMLButtonElement => {
    const to = index + by;
    const value = spec.values[to];
    const button = el("button", "knob-step");
    button.type = "button";
    button.textContent = by < 0 ? "−" : "+";
    button.disabled = value === undefined;
    button.setAttribute(
      "aria-label",
      `${by < 0 ? "Lower" : "Raise"} ${spec.legend.toLowerCase()}`,
    );
    if (value !== undefined) {
      button.addEventListener("click", () => {
        spec.onPick(value);
      });
    }
    return button;
  };

  const value = el("output", "knob-value");
  value.textContent = spec.format(spec.values[index] ?? spec.at);
  row.append(move(-1), value, move(1));
  set.append(row);
  return set;
}

export interface Switch {
  id: string;
  label: string;
  note?: string;
  on: boolean;
}

export interface Switches {
  legend: string;
  note?: string;
  items: readonly Switch[];
  // Radio for a state the thing is in, checkbox for things it can each be.
  kind: "checkbox" | "radio";
  onToggle: (id: string, on: boolean) => void;
}

let group = 0;

export function switches(spec: Switches): HTMLElement {
  const set = frame(spec.legend, spec.note);
  const name = `knob${String((group += 1))}`;

  for (const item of spec.items) {
    const label = el("label", "knob-switch");
    const input = el("input");
    input.type = spec.kind;
    input.name = name;
    input.checked = item.on;
    input.addEventListener("change", () => {
      spec.onToggle(item.id, input.checked);
    });

    const text = el("span");
    text.textContent = item.label;
    label.append(input, text);

    if (item.note !== undefined) {
      const note = el("small");
      note.textContent = item.note;
      label.append(note);
    }
    set.append(label);
  }
  return set;
}
