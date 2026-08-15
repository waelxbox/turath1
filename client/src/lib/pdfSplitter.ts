/**
 * Client-side PDF Splitter
 * =========================
 * Uses pdf.js to render PDF pages to PNG images in the browser.
 * Each page is rendered to a canvas and exported as a PNG blob.
 */

import * as pdfjsLib from "pdfjs-dist";

// Set the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface PdfPageResult {
  pageNumber: number;
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

/**
 * Get the number of pages in a PDF file.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}

/**
 * Split a PDF file into individual page images (PNG blobs).
 * Renders at 2x scale for good quality on archival documents.
 * 
 * @param file - The PDF file to split
 * @param onProgress - Optional callback for progress updates (0-100)
 * @returns Array of page results with PNG blobs
 */
export async function splitPdfToImages(
  file: File,
  onProgress?: (percent: number, currentPage: number, totalPages: number) => void
): Promise<PdfPageResult[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const results: PdfPageResult[] = [];
  const baseName = file.name.replace(/\.pdf$/i, "");

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    
    // Render at 2x scale for good quality (archival documents need detail)
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    // Create an offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    // Render the page
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    // Convert canvas to PNG blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
        "image/png",
        0.92
      );
    });

    results.push({
      pageNumber: i,
      blob,
      filename: `${baseName}_page_${String(i).padStart(3, "0")}.png`,
      width: viewport.width,
      height: viewport.height,
    });

    // Report progress
    if (onProgress) {
      onProgress(Math.round((i / totalPages) * 100), i, totalPages);
    }

    // Clean up canvas
    canvas.width = 0;
    canvas.height = 0;
  }

  return results;
}
