// Pure selection geometry for the Picture this popover.

// Document coordinates from the selection rect plus page scroll, so the
// popover stays on the selection however scenes are laid out (paged or
// continuous scroll, several scenes mounted at once).
export function popoverPos(
  rect: { top: number; left: number; width: number },
  scroll: { x: number; y: number },
): { top: number; left: number } {
  return { top: rect.top + scroll.y - 8, left: rect.left + scroll.x + rect.width / 2 };
}

export function paraOf(node: Node | null): Element | null {
  if (!node) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return el?.closest?.("p[id]") ?? null;
}
