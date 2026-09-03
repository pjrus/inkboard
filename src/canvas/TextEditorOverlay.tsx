import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { CanvasDocument } from "../document/crdt";
import { TEXT_LINE_HEIGHT, type TextObject, type Viewport } from "../document/schema";
import { fontStack } from "../text/fonts";
import { textHeight } from "../text/textMeasure";
import type { CanvasRenderer } from "./CanvasRenderer";
import { objectCenter, rotatePoint } from "./transform";

/** How long after opening a stray blur is treated as the browser, not the user. */
const FOCUS_GRACE_MS = 250;

/**
 * CSS transform placing the editor over its world-space box.
 *
 * A rotated box keeps its rotation while it is being edited: the textarea is
 * turned by the same angle, so wrapping, font and size are preserved and the
 * caret lands where the glyphs are. Rotation is never reset by editing.
 */
function hostTransform(o: TextObject, vp: Viewport): string {
  const angle = o.rotation ?? 0;
  // The element's own origin is its top-left, so the *rotated* position of
  // that corner is where it has to sit before the box is turned.
  const corner = angle === 0 ? { x: o.x, y: o.y } : rotatePoint({ x: o.x, y: o.y }, objectCenter(o), angle);
  const t = `translate(${corner.x * vp.scale + vp.x}px, ${corner.y * vp.scale + vp.y}px) scale(${vp.scale})`;
  return angle === 0 ? t : `${t} rotate(${angle}rad)`;
}

interface Props {
  doc: CanvasDocument;
  renderer: CanvasRenderer;
  objectId: string;
  onFinish: () => void;
}

/**
 * The inline text editor: a single <textarea> positioned over the canvas.
 *
 * Only the box being edited gets a DOM editor - every other text object is
 * drawn by the canvas renderer - so a board with hundreds of text objects
 * never has hundreds of live editors.
 *
 * The overlay is laid out in *world* units and scaled by the viewport, so the
 * textarea wraps exactly where the canvas wraps and stays glued to its box
 * through pans, zooms and pinches.
 */
export function TextEditorOverlay({ doc, renderer, objectId, onFinish }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const object = doc.get(objectId);
  const openedAt = useRef(0);
  const [, force] = useState(0);

  // Keep the overlay aligned with its world-space box on every viewport change.
  useLayoutEffect(() => {
    const apply = (vp: Viewport) => {
      const host = hostRef.current;
      const o = doc.get(objectId);
      if (!host || o?.type !== "text") return;
      host.style.transform = hostTransform(o, vp);
    };
    apply(renderer.getViewport());
    return renderer.onViewportChanged(apply);
  }, [doc, renderer, objectId]);

  // Re-render when the object's own properties change (font, size, width...).
  useEffect(
    () =>
      doc.onChange((changes) => {
        if (changes.some((c) => c.id === objectId)) force((n) => n + 1);
      }),
    [doc, objectId],
  );

  // Bind the textarea to the Y.Text: local edits become splices, remote edits
  // are merged back in with the caret carried across.
  useEffect(() => {
    const ytext = doc.getTextHandle(objectId);
    const area = areaRef.current;
    if (!ytext || !area) return;
    area.value = ytext.toString();
    const observer = () => {
      const next = ytext.toString();
      if (area.value === next) return;
      const start = relativePosition(ytext, area.selectionStart);
      const end = relativePosition(ytext, area.selectionEnd);
      area.value = next;
      area.setSelectionRange(absolutePosition(doc, ytext, start, next.length), absolutePosition(doc, ytext, end, next.length));
      force((n) => n + 1);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [doc, objectId]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    openedAt.current = performance.now();
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }, [objectId]);

  if (object?.type !== "text") return null;
  const vp = renderer.getViewport();
  const height = textHeight(object);

  return (
    <div
      ref={hostRef}
      className="text-editor-host"
      style={{ transform: hostTransform(object, vp) }}
    >
      <textarea
        ref={areaRef}
        className="text-editor"
        aria-label="Text box content"
        spellCheck={false}
        style={{
          width: object.width,
          height,
          fontFamily: fontStack(object.fontFamily),
          fontSize: object.fontSize,
          lineHeight: TEXT_LINE_HEIGHT,
          color: object.color,
          textAlign: object.textAlign ?? "left",
          // Chrome is used only to hint the editable region; the outline is
          // drawn at a constant screen width regardless of zoom.
          outlineWidth: Math.max(0.5, 1 / vp.scale),
        }}
        onInput={(e) => {
          const ytext = doc.getTextHandle(objectId);
          if (!ytext) return;
          spliceText(doc, objectId, ytext, (e.target as HTMLTextAreaElement).value);
          force((n) => n + 1);
        }}
        onKeyDown={(e) => {
          // Canvas shortcuts must never fire while typing; only Escape leaves.
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onFinish();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => {
          // The gesture that opened the editor can hand focus back to the page
          // a beat later; take it back rather than reading that as the user
          // clicking away. A real click outside arrives well after the grace
          // period and ends the edit as it should.
          if (performance.now() - openedAt.current < FOCUS_GRACE_MS) {
            areaRef.current?.focus({ preventScroll: true });
            return;
          }
          onFinish();
        }}
      />
    </div>
  );
}

/**
 * Turn a textarea value into a minimal Y.Text splice.
 *
 * Replacing the whole string on every keystroke would work locally but would
 * destroy a concurrent editor's insertions; a prefix/suffix diff produces the
 * insert/delete pair a collaborative text type expects.
 */
function spliceText(doc: CanvasDocument, objectId: string, ytext: Y.Text, next: string) {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  doc.editText(objectId, (t) => {
    if (endPrev > start) t.delete(start, endPrev - start);
    if (endNext > start) t.insert(start, next.slice(start, endNext));
  });
}

function relativePosition(ytext: Y.Text, index: number): Y.RelativePosition {
  return Y.createRelativePositionFromTypeIndex(ytext, Math.min(index, ytext.length));
}

function absolutePosition(doc: CanvasDocument, ytext: Y.Text, rel: Y.RelativePosition, fallback: number): number {
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc.ydoc);
  return abs && abs.type === ytext ? abs.index : fallback;
}
