import { PDFParse } from "pdf-parse";

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const text = result.text.replace(/\r\n?/g, "\n").trim();

    if (!text) {
      throw new Error("The PDF contains no extractable text.");
    }

    return text;
  } finally {
    await parser.destroy();
  }
}

