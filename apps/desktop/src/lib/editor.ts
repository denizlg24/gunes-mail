import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";

/** One schema for compose and the signature editor, so a signature survives being inserted. */
export function richTextExtensions(placeholder: string) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    TextStyle,
    Color,
    FontSize,
    FontFamily,
    Image.configure({
      inline: true,
      allowBase64: true,
      resize: { enabled: true, directions: ["bottom-right"], minWidth: 24, minHeight: 24, alwaysPreserveAspectRatio: true },
    }),
    Placeholder.configure({ placeholder }),
  ];
}

export const TEXT_COLORS = [
  { label: "Black", value: "#000000" },
  { label: "Gray", value: "#616161" },
  { label: "Red", value: "#c50f1f" },
  { label: "Orange", value: "#ca5010" },
  { label: "Gold", value: "#986f0b" },
  { label: "Green", value: "#107c10" },
  { label: "Teal", value: "#038387" },
  { label: "Blue", value: "#0f6cbd" },
  { label: "Purple", value: "#5c2e91" },
  { label: "Berry", value: "#c239b3" },
];

export const FONT_SIZES = ["10px", "12px", "14px", "16px", "20px", "24px"];

export const FONT_FAMILIES = [
  { label: "Segoe UI", value: "Segoe UI, Helvetica, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "Times New Roman, Times, serif" },
  { label: "Courier New", value: "Courier New, monospace" },
];

/** Embedded pictures travel inside every message, so keep them small. */
export const MAX_IMAGE_BYTES = 200 * 1024;
const MAX_IMAGE_WIDTH = 600;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't an image we can read"));
    img.src = src;
  });
}

function dataUrlBytes(dataUrl: string): number {
  return Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
}

/**
 * Turns a picked or pasted image into a data URI small enough to embed: GIFs pass through
 * untouched to keep their animation, everything else is scaled down and re-encoded.
 */
export async function imageToDataUrl(file: File): Promise<{ src: string; width: number }> {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  if (file.type === "image/gif") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Animated GIFs must be under 200 KB");
    return { src: original, width: Math.min(img.naturalWidth, MAX_IMAGE_WIDTH) };
  }

  const keepAlpha = file.type === "image/png" || file.type === "image/webp" || file.type === "image/svg+xml";
  let width = Math.min(img.naturalWidth || MAX_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
  for (let attempt = 0; attempt < 5; attempt++) {
    const height = Math.round((width / (img.naturalWidth || width)) * (img.naturalHeight || width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the image");
    if (!keepAlpha) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const src = keepAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrlBytes(src) <= MAX_IMAGE_BYTES) return { src, width };
    width = Math.round(width * 0.75);
  }
  throw new Error("That image is too large to embed. Try a smaller one.");
}
