import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

export async function extractTextFromFile(filePath: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".pdf") {
    return extractPdf(filePath);
  }

  if (ext === ".docx") {
    return extractDocx(filePath);
  }

  throw new Error("Unsupported file type. Please upload a PDF or DOCX file.");
}

async function extractPdf(filePath: string) {
  const { PDFParse } = await import("pdf-parse");
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text || "").replace(/\r/g, "").trim();
    if (!text) {
      throw new Error("No text could be extracted from this PDF.");
    }
    return text;
  } finally {
    await parser.destroy?.();
  }
}

async function extractDocx(filePath: string) {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value || "").replace(/\r/g, "").trim();
  if (!text) {
    throw new Error("No text could be extracted from this DOCX.");
  }
  return text;
}
