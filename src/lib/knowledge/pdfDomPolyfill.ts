/**
 * pdfjs (via pdf-parse) expects browser DOM geometry types. Node on Vercel has no DOMMatrix, etc.
 * Install @napi-rs/canvas implementations on globalThis before loading pdf-parse.
 */
import { DOMMatrix, DOMPoint, DOMRect, ImageData, Path2D } from '@napi-rs/canvas';

const g = globalThis as Record<string, unknown>;

if (typeof globalThis.DOMMatrix === 'undefined') g.DOMMatrix = DOMMatrix;
if (typeof globalThis.DOMPoint === 'undefined') g.DOMPoint = DOMPoint;
if (typeof globalThis.DOMRect === 'undefined') g.DOMRect = DOMRect;
if (typeof globalThis.Path2D === 'undefined') g.Path2D = Path2D;
if (typeof globalThis.ImageData === 'undefined') g.ImageData = ImageData;
