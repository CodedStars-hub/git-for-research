import { extractPdfText } from "@/lib/ingestion/pdf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Select a PDF file." }, { status: 400 });
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return Response.json(
        { error: "Unsupported file type. Select a PDF file." },
        { status: 415 },
      );
    }

    const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    return Response.json({ text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PDF extraction failed.";
    return Response.json(
      { error: `Could not extract text from this PDF: ${message}` },
      { status: 422 },
    );
  }
}
