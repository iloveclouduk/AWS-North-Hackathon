// DOM walking that also sees inside open shadow roots (some console widgets render there).
// Closed shadow roots are invisible to page scripts, so they're invisible to the Copilot too.

export type Root = Document | ShadowRoot | Element;

/** Every element under `root` in document order, descending into open shadow roots right after their host. */
export function* deepElements(root: Root): Generator<Element> {
  for (const el of root.querySelectorAll('*')) {
    yield el;
    if (el.shadowRoot) yield* deepElements(el.shadowRoot);
  }
}

export function deepQueryAll(root: Root, selector: string): Element[] {
  const out: Element[] = [];
  for (const el of deepElements(root)) if (el.matches(selector)) out.push(el);
  return out;
}

export function deepQuery(root: Root, selector: string): Element | undefined {
  const light = root.querySelector(selector);
  if (light) return light;
  for (const el of deepElements(root)) if (el.matches(selector)) return el;
  return undefined;
}

/** The document or shadow root an element lives in (where its id references resolve). */
export function rootOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot || r instanceof Document ? r : el.ownerDocument;
}

/** Resolve an id reference (aria-labelledby, aria-controls, label[for]) from the element's own root, then the document. */
export function byIdFrom(el: Element, id: string): Element | undefined {
  if (!id) return undefined;
  const root = rootOf(el);
  return root.getElementById(id) ?? el.ownerDocument.getElementById(id) ?? undefined;
}
